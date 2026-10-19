import { inject, injectable } from 'tsyringe';
import type Segment from '../../core/models/Segment';
import type { Section, Map, MapAnimationInput, ChromaKey } from '@/core/types';
import type { BackgroundLayer } from '../../schemas/template.schemas';
import { buildAnimationLegFilters, overlayMotionExpr, type OverlayMotion } from '../utils/input-sources';
import type FormattersManager from './FormatterManager';
import type FilterManager from './FilterManager';
import { escapeRegExp } from './VariableManager';
import { assertSafeColorToken, assertSafeExpression } from '@/core/arg-guard';
import { isBackgroundInput } from '../utils/background-input';
import { layerKeyframes } from '../presets/layer-keyframes';
import { resolveFit } from '../utils/reframe';
import { compositeLayer } from '../presets/layer-composite';
import { videoClipInputIndex } from '../utils/video-clip-input';
import { clipBoxSteps, evenBox, finiteBox, frameSize, type CutIO, type MapStep } from '../presets/clip-box';
import { overlayOptions, type OverlayPlan } from '../presets/overlay-options';
import type { LayerMask, MaskMode } from '../../schemas/mask.schemas';
import { layerMaskPlan, type MatteLeg } from '../presets/layer-masks';
import { matteLegFilters } from '../presets/mask-source';
import { sectionMatteSteps } from '../presets/section-mask';
import { assertSafePadLabel } from '../utils/filter-option-guard';

// Section.inputs is typed as Input[] for schema purposes, but at runtime it holds
// MapAnimationInput objects indexed by string keys (used as a keyed record).
type SectionInputsCache = Record<string, MapAnimationInput>;

@injectable()
class MapManager {
  constructor(
    @inject('FormattersManager') protected formattersManager: FormattersManager,
    @inject('FilterManager') protected filterManager: FilterManager,
    @inject('segment') public segment: Segment
  ) {}

  private get currentSection(): Section {
    if (!this.segment.currentSection) {
      throw new Error('[MapManager] currentSection is not set');
    }

    return this.segment.currentSection;
  }

  addMap = (map: Map): void => {
    let mappedInputs = '';
    let mappedOutputs = '';

    // Labels come from authored maps and input names: each must stay one `[label]`.
    for (const input of map.inputs) {
      mappedInputs += `[${assertSafePadLabel(this.mapInputsVariables(input))}]`;
    }

    for (const output of map.outputs) {
      mappedOutputs += `[${assertSafePadLabel(output)}]`;
      this.segment.mapsList.push(output);
    }

    // Manage optional attributs
    map.options ??= {};
    map.filters ??= [];

    if ((map.options.useSectionFilters || Object.keys(map.filters).length === 0) && this.currentSection.filters) {
      map.filters = [
        // Add background filters
        ...map.filters,
        ...this.currentSection.filters,
      ];
    }

    // Process single filters
    const filtersMapList = map.filters.map((filter) => this.filterManager.addFilter(filter));

    this.segment.filtersMapList.push(mappedInputs + filtersMapList.join(',') + mappedOutputs);
  };

  /**
   * Composites one animation input over the main video as a SINGLE overlay map.
   *
   * The animation is one `-i` input (a single `.apng`/`.webp`/`.gif`/`.webm` file) sitting at
   * stream index `inputIndex`. We overlay
   * it onto the main video (`getVideoInputIncrement():v`) and emit a pad named after the input
   * so authored maps can reference it as `@<name>` (resolved by `mapInputsVariables`).
   *
   * `eof_action=repeat` freezes the last animation frame for the rest of the section when
   * `persistent` is set; `pass` lets the main video show through once the animation ends.
   *
   * BOTH legs are scaled to the output resolution BEFORE the overlay: the main-video leg is
   * normalized to `videoScale` and the animation leg to its declared `options.scale`. Without this
   * the animation composites onto the raw (often larger) input and the section's trailing scale
   * shrinks the whole frame — pushing a full-screen animation into the top-left corner. Per-input
   * filters and the section chain (blur/draw/fade) still run after the overlay, preserving layering.
   * The first animation of the section carries `useSectionFilters`.
   */
  // Builds the background the first section animation composites onto: normalize the raw video leg to
  // the output resolution, then bake the section's authored chain (blur/draw/fade) into it — so the
  // animation overlays ON TOP of the finished background rather than being blurred/shrunk with it
  // (which buried full-frame borders behind the blur). Returns the pad to use as the overlay base.
  private readonly buildAnimationBackground = (name: string, videoStream: string, videoScale: string): string => {
    let baseStream = videoStream;

    // unshift keeps the normalize pad defined before the background map that consumes it. COVER (scale up
    // to fill, then crop the overflow) preserves the clip's aspect — a bare `scale=W:H` would stretch a
    // source whose ratio differs from the output (e.g. a portrait clip under a 1:1 square template). A
    // letterboxed section keeps the whole frame with bars instead, as it does without overlays.
    if (videoScale) {
      const normalizedPad = assertSafePadLabel(`${name}_norm`);
      const fit =
        resolveFit(this.currentSection.options) === 'letterbox'
          ? `force_original_aspect_ratio=decrease,pad=${videoScale}:(ow-iw)/2:(oh-ih)/2`
          : `force_original_aspect_ratio=increase,crop=${videoScale}`;
      this.segment.filtersMapList.unshift(`[${videoStream}]scale=${videoScale}:${fit},setsar=1[${normalizedPad}]`);
      baseStream = normalizedPad;
    }

    // Only build a background map when the section has filters to bake in; otherwise the animation
    // overlays straight onto the (normalized) video leg.
    if ((this.currentSection.filters?.length ?? 0) > 0) {
      const backgroundPad = assertSafePadLabel(`${name}_bg`);
      this.addMap({
        inputs: [baseStream],
        filters: [],
        outputs: [backgroundPad],
        options: { useSectionFilters: true },
      });
      baseStream = backgroundPad;
    }

    return baseStream;
  };

  // The first overlay of a section builds the background; later ones chain off the previous overlay output.
  private readonly overlayBase = (name: string, videoStream: string, videoScale: string): string =>
    this.segment.inputsMapCount === 0
      ? this.buildAnimationBackground(name, videoStream, videoScale)
      : (this.segment.mapsList.at(-1) ?? videoStream);

  // Prepares the animation leg before the overlay: scale it to its declared size and fade it when
  // opacity < 1 (shared with the whole-video AnimationComposer so both composite identically). A
  // `motion` fade appends its alpha fade-in on an rgba frame.
  private readonly animationLegFilters = (input: MapAnimationInput, motion: OverlayMotion): string[] => {
    const legFilters = buildAnimationLegFilters(input.options);

    if (motion.legFilter) {
      if (!legFilters.includes('format=rgba')) {
        legFilters.push('format=rgba');
      }

      legFilters.push(motion.legFilter);
    }

    return legFilters;
  };

  // When leg filters exist the chain is prepended to the graph and its named pad returned; otherwise the
  // raw `${inputIndex}:v` leg.
  private readonly registerLeg = (input: MapAnimationInput, inputIndex: number, legFilters: string[]): string => {
    if (legFilters.length === 0) {
      return `${inputIndex}:v`;
    }

    const animationPad = assertSafePadLabel(`${input.name}_src`);
    this.segment.filtersMapList.unshift(`[${inputIndex}:v]${legFilters.join(',')}[${animationPad}]`);

    return animationPad;
  };

  // The leg and the overlay position. `options.animate` keyframe tracks own both (presets/layer-keyframes);
  // otherwise an optional `motion` animates the entrance: slide/rise emit overlay x/y time-expressions,
  // fade adds an alpha fade-in to the overlay leg.
  private readonly overlayPlan = (input: MapAnimationInput, position: string): OverlayPlan => {
    if (input.options.animate) {
      return layerKeyframes(input.options, this.filterManager.frameRate());
    }

    const motion = overlayMotionExpr(input.options.motion, position);

    return { legFilters: this.animationLegFilters(input, motion), x: motion.x, y: motion.y };
  };

  addAnimationOverlay = (input: MapAnimationInput, inputIndex: number, videoScale = '', matte?: MatteLeg): void => {
    const videoStream = `${this.getVideoInputIncrement()}:v`;
    // The position lands unquoted in `overlay=<x:y>`: two expression terms only (core/arg-guard.ts).
    const position = assertSafeExpression(input.options.position || '0:0', 'overlay position', 2);

    // First animation of the section builds the background (normalize + section filters) on the main
    // video leg; later animations chain off the prior overlay output instead.
    const baseStream = this.overlayBase(input.name, videoStream, videoScale);

    const plan = this.overlayPlan(input, position);
    const overlay = overlayOptions(input, plan, position);

    this.segment.inputsMapCount++;

    // A blend mode or motion blur: one spliced graph that owns the leg (presets/layer-composite.ts). A clipped
    // or masked layer cuts through its own maps instead (validation refuses the pairing).
    const composite = { input, inputIndex, base: baseStream, legFilters: plan.legFilters, overlay };

    if (
      !this.cutsLayer(input) &&
      compositeLayer({ ...composite, filters: this.filterManager, segment: this.segment })
    ) {
      return;
    }

    // The animation overlays on top of the already-filtered background; no section filters here.
    // `input.filters` is optional in the schema (builder-authored inputs omit it), so default to none.
    const leg = this.registerLeg(input, inputIndex, plan.legFilters);
    const io: CutIO = { base: baseStream, leg, overlay, name: input.name, filters: input.filters ?? [] };

    if (input.options.mask) {
      this.addMasked(input.options.mask, input, io, videoScale, matte);

      return;
    }

    if (input.options.clip) {
      this.addSteps(clipBoxSteps(io, evenBox(finiteBox(input.options.clip), ...frameSize(videoScale))));

      return;
    }

    this.addMap({
      inputs: [baseStream, leg],
      filters: [{ type: 'overlay', value: overlay }, ...io.filters],
      outputs: [input.name],
      options: { useSectionFilters: false },
    });
  };

  private readonly cutsLayer = (input: MapAnimationInput): boolean =>
    input.options.mask !== undefined || input.options.clip !== undefined;

  // A layer cut by options.mask (presets/layer-masks.ts): its source leg chains first, then the composite maps.
  private readonly addMasked = (
    mask: LayerMask,
    input: MapAnimationInput,
    io: CutIO,
    videoScale: string,
    matte?: MatteLeg
  ): void => {
    const plan = layerMaskPlan(mask, {
      io,
      position: (this.currentSection.inputs ?? []).findIndex((candidate) => candidate.name === input.name),
      fps: this.filterManager.frameRate(),
      frame: frameSize(videoScale),
      available: this.filterManager.supports('alphamerge'),
      extraInput: (key) => this.segment.extraInputs[key],
      matte,
    });

    this.segment.filtersMapList.unshift(...plan.chains);
    this.addSteps(plan.steps);
  };

  /** Registers a track matte layer's grey leg (presets/mask-source.ts) without drawing it. */
  registerMatte = (input: MapAnimationInput, inputIndex: number, mode?: MaskMode): MatteLeg => {
    const position = assertSafeExpression(input.options.position || '0:0', 'overlay position', 2);
    const plan = this.overlayPlan(input, position);
    const pad = this.registerLeg(
      { ...input, name: `${input.name}.mt` },
      inputIndex,
      matteLegFilters(mode, plan.legFilters)
    );

    return { pad, overlay: overlayOptions(input, plan, position) };
  };

  /** The section clip through its track matte (options.mask.layer): the base every later layer draws on. */
  addSectionMatte = (matte: MatteLeg, videoScale: string): void => {
    const mask = this.currentSection.options?.mask;
    const videoStream = `${this.getVideoInputIncrement()}:v`;
    // Gradient layers already drawn are the base, not rebuilt: the clip's own background only comes first.
    const base = this.overlayBase('sm.s.mk', videoStream, videoScale);
    const color = this.formattersManager.formatColor(mask?.background ?? 'black');

    this.segment.inputsMapCount++;
    this.addSteps(
      sectionMatteSteps({ mask: mask ?? {}, matte, base, background: assertSafeColorToken(color, 'mask.background') })
    );
  };

  // Overlay maps built by a preset (clip boxes, masks): each its own map, never with the section filters.
  private readonly addSteps = (steps: MapStep[]): void => {
    for (const step of steps) this.addMap({ ...step, options: { useSectionFilters: false } });
  };

  /**
   * Composites one gradient layer (a lavfi `gradients` input at `gradientIndex`) over the main
   * stream as a single overlay map. Opacity < 1 fades the gradient leg via
   * `format=rgba,colorchannelmixer=aa=<opacity>` before the overlay.
   *
   * A layer `reveal` animates the entrance with the same overlay-motion machinery the animation
   * overlays use (overlayMotionExpr): fade adds an alpha fade-in on the gradient leg; rise/slide
   * emit overlay x/y time expressions easing to the layer position. All core LGPL filters, so the
   * on-device (--disable-gpl) build keeps parity. No reveal keeps the output byte-identical.
   *
   * The first overlay map of the section carries `useSectionFilters` so the section's authored
   * filter chain is folded into the main-stream leg (see SegmentBuilder.buildGradientLayers for
   * the resulting overlay-after-filters ordering).
   */
  // Leg filters (opacity fade + reveal fade-in) run on the gradient's own chain so the main stream is
  // untouched; both need an rgba frame first. When filters exist the chain is prepended to the graph
  // and its named pad returned; otherwise the raw `${gradientIndex}:v` leg.
  private readonly buildGradientLeg = (
    gradientIndex: number,
    outputName: string,
    opacity: number,
    motion: OverlayMotion
  ): string => {
    const legFilters: string[] = [];

    if (opacity < 1 || motion.legFilter) legFilters.push('format=rgba');

    if (opacity < 1) legFilters.push(`colorchannelmixer=aa=${opacity}`);

    if (motion.legFilter) legFilters.push(motion.legFilter);

    if (legFilters.length === 0) {
      return `${gradientIndex}:v`;
    }

    const legPad = assertSafePadLabel(`${outputName}_op`);
    // unshift, not push: the pad must be defined before the overlay map that consumes it,
    // or ffmpeg fails with an undefined stream specifier.
    this.segment.filtersMapList.unshift(`[${gradientIndex}:v]${legFilters.join(',')}[${legPad}]`);

    return legPad;
  };

  addGradientOverlay = (layer: BackgroundLayer, gradientIndex: number, outputName: string, position?: string): void => {
    const useSectionFilters = this.segment.inputsMapCount === 0;
    const videoStream = `${this.getVideoInputIncrement()}:v`;
    const baseStream = useSectionFilters ? videoStream : (this.segment.mapsList.at(-1) ?? videoStream);

    // SegmentBuilder passes the layer x/y resolved to pixels (overlay expressions have no iw/ih,
    // so the UI's `iw*0.25`-style values must be lowered first); raw layer values are the legacy
    // fallback for callers that already hold pixel numbers.
    const overlayPosition = position ?? `${layer.x ?? 0}:${layer.y ?? 0}`;
    const opacity = layer.opacity ?? 1;
    const motion = overlayMotionExpr(layer.reveal, overlayPosition);

    const gradientLeg = this.buildGradientLeg(gradientIndex, outputName, opacity, motion);

    this.segment.inputsMapCount++;

    // A moving entrance uses the named, single-quoted overlay form (the time expressions hold
    // commas); otherwise the static positional "x:y" form keeps existing output unchanged.
    const overlayValue = motion.x || motion.y ? `x='${motion.x}':y='${motion.y}'` : overlayPosition;

    this.addMap({
      inputs: [baseStream, gradientLeg],
      filters: [{ type: 'overlay', value: overlayValue }],
      outputs: [outputName],
      options: {
        useSectionFilters,
      },
    });
  };

  /**
   * Removes a solid screen colour from the section clip and composites it over a solid background —
   * a green/blue-screen key. The graph is INVERTED relative to addAnimationOverlay (the background is
   * the base, the clip the overlay), but it needs NO extra `-i` input: the clip is `split`, one leg is
   * painted a flat colour by `drawbox` to become the background, the other is keyed and overlaid back.
   * Because no input is added, stream indices never shift (unlike the no-audio anullsrc fix).
   *
   * v1 is solid-background only (no simultaneous animation overlay or background image). The graph is a
   * single self-contained filter_complex from the video stream to `[ck_out]`, which becomes the final
   * mapped pad; the section's own scale chain is folded in so the clip is sized to the output first.
   *
   * `videoInputIndex` is the segment's authoritative clip stream (VideoSegment shifts it to 1 when it
   * prepends blank audio); getVideoInputIncrement derives the same index from the shared rule.
   * `head` (already formatted footage edits: clip range / ramp / freeze) retimes the clip first.
   */
  addChromakeyComposite = (
    chromaKey: ChromaKey,
    videoInputIndex: number,
    videoScale = '',
    head: string[] = []
  ): void => {
    const videoStream = `${videoInputIndex}:v`;
    // Both colours land unquoted in the graph (`colorkey=<c>`, `drawbox=…color=<c>`): one colour token each.
    const color = assertSafeColorToken(this.formattersManager.formatColor(chromaKey.color), 'chromaKey.color');
    const similarity = chromaKey.similarity ?? 0.3;
    const blend = chromaKey.blend ?? 0.1;
    const background = assertSafeColorToken(
      this.formattersManager.formatColor(
        chromaKey.background ?? this.currentSection.options?.backgroundColor ?? 'black'
      ),
      'chromaKey.background'
    );

    const scaleChain = videoScale
      ? `scale=${videoScale}:force_original_aspect_ratio=increase,crop=${videoScale},setsar=1,`
      : '';

    const retime = head.map((filter) => `${filter},`).join('');

    this.segment.filtersMapList.push(
      `[${videoStream}]${retime}${scaleChain}split[ck_a][ck_b];` +
        `[ck_a]drawbox=x=0:y=0:w=iw:h=ih:color=${background}@1:t=fill[ck_bg];` +
        `[ck_b]colorkey=${color}:${similarity}:${blend},format=rgba[ck_keyed];` +
        `[ck_bg][ck_keyed]overlay=0:0[ck_out]`
    );
    this.segment.mapsList.push('ck_out');
    this.segment.inputsMapCount++;
  };

  getVideoInputIncrement = (): number => {
    let increment = 0;

    switch (this.currentSection.type) {
      case 'project_video':
        // A muted clip is preceded by the blank-audio input (ProjectVideoSegment.videoInputIndex).
        increment = this.currentSection.options?.muteSection === true ? 1 : 0;
        break;
      case 'video':
        // The blank-audio input VideoSegment prepends shifts a muted clip to 1.
        increment = videoClipInputIndex(this.currentSection.options);
        break;
      default:
        increment = 1;
    }

    return increment;
  };

  /**
   * Resolves `@name` input references in a map's `inputs` to concrete stream labels.
   *
   * Each section input is now exactly one `-i` source (no per-frame explosion), so the
   * stream index of the authored input at position `i` is `getVideoInputIncrement() + 1 + i`: the
   * main video (or the injected section background) sits at `getVideoInputIncrement()`, and asset
   * inputs follow it in section order.
   *
   * Animation inputs are composited by `addAnimationOverlay` into an overlay pad named after
   * the input, so `@<animName>` resolves to that pad label rather than a raw `:v` stream.
   */
  mapInputsVariables = (value: string): string => {
    const section = this.currentSection;
    const inputs = section.inputs as unknown as SectionInputsCache | undefined;

    let result = value;

    if (inputs && Object.keys(inputs).length > 0) {
      // `@video` is anchored to the whole string, so it can only ever match once.
      // Resolve it a single time instead of re-scanning on every input.
      result = result.replace(/^@video$/g, `${this.getVideoInputIncrement()}:v`);

      // The input name is author-chosen free text, so it is escaped (metacharacters like `(` would
      // otherwise build an invalid or wrong RegExp), matched longest-first (so `logo` can never
      // rewrite the front of `@logo2`), and end-anchored against a following name character. The
      // stream index still comes from each input's ORIGINAL authored position.
      // The injected section background is the `@video` leg, not a `@name` input: it is skipped, so an
      // input named after the section resolves to itself, numbered from the stream after the background.
      const entries = Object.keys(inputs)
        .map((key) => inputs[key])
        .filter((input) => !isBackgroundInput(input))
        .map((input, position) => ({ input, position }))
        .sort((a, b) => b.input.name.length - a.input.name.length);

      for (const { input, position } of entries) {
        const reference = new RegExp(`@${escapeRegExp(input.name)}(?![\\w-])`, 'g');

        // Animation inputs are composited into an overlay pad named after the input:
        // `@foo` → `foo`, the pad label emitted by addAnimationOverlay (dropping the `@`).
        if (input.type === 'animation') {
          result = result.replace(reference, input.name);

          continue;
        }

        const increment = this.getVideoInputIncrement() + 1 + position;

        result = result.replace(reference, `${increment}:v`);
      }
    }

    return result;
  };
}

export default MapManager;
