import { injectable, inject, container } from 'tsyringe';
import type AbstractLogger from '../platform/logging/AbstractLogger';
import type AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import type { Filter, MapAnimationInput, Section, SectionOptions } from '@/core/types';
import type Template from '../core/models/Template';
import type Project from '../core/models/Project';
import type Segment from '../core/models/Segment';
import DefaultConfig from '@/core/default.config';
import type AssetManager from '../editor/managers/AssetManager';
import type VariableManager from '../editor/managers/VariableManager';
import type MapManager from '../editor/managers/MapManager';
import type FilterManager from '../editor/managers/FilterManager';
import type FormattersManager from '../editor/managers/FormatterManager';
import { assertSafeArgToken } from '@/core/arg-guard';
import { SectionError } from '@/core/errors/section-error';
import {
  compileSugarLayers,
  compileGlobalDecorations,
  compositingContext,
  createEmojiPlan,
  createExtraInputs,
  type EmojiPlan,
  type SugarContext,
} from './presets/registry';
import {
  buildSingleFileAnimationSource,
  buildSingleFileImageSource,
  buildGradientSource,
  resolveLayerGeometry,
} from './utils/input-sources';
import { buildAudioFadeArg } from './utils/audio-fade';
import { getPerfTimer } from '../utils/perf-timer';
import {
  resolveVideoCodec,
  isHardwareCodec,
  buildPixFmtArg,
  buildVideoEncoderArgs,
  buildColorMetadataArgs,
  buildColorMetadataFilter,
} from '@/core/encoding';
import {
  cameraEndOfChain,
  framedCamera,
  conformMotionChain,
  motionSugarContext,
  reframeFilters,
  sectionFootageHead,
} from './presets/motion-chain';

// Bag of all service-layer dependencies injected into SegmentBuilder.
// A single token keeps the constructor within the max-params budget (5).
type SegmentManagersBag = {
  assetManager: AssetManager;
  variableManager: VariableManager;
  mapManager: MapManager;
  filterManager: FilterManager;
  formattersManager: FormattersManager;
  logger: AbstractLogger;
  filesystemAdapter: AbstractFilesystem;
};

// Lazy factory: resolved tokens are available by the time SegmentBuilder
// is first resolved from the container, so there is no ordering problem.
container.register<SegmentManagersBag>('SegmentManagersBag', {
  useFactory: (c) => ({
    assetManager: c.resolve<AssetManager>('AssetManager'),
    variableManager: c.resolve<VariableManager>('VariableManager'),
    mapManager: c.resolve<MapManager>('MapManager'),
    filterManager: c.resolve<FilterManager>('FilterManager'),
    formattersManager: c.resolve<FormattersManager>('FormattersManager'),
    logger: c.resolve<AbstractLogger>('logger'),
    filesystemAdapter: c.resolve<AbstractFilesystem>('filesystemAdapter'),
  }),
});

// Runtime-typed view of segment.inputsAsset used as a string-keyed store.
type InputsAssetMap = Record<string, string>;
// What a sugar lowering asks to stage as an extra input (presets/sugar-context.ts ExtraInputSource).
type ExtraInputSource = Parameters<NonNullable<SugarContext['masks']>['input']>[1];

@injectable()
class SegmentBuilder {
  protected command = '-version';

  protected filters = ''; // FFmpeg filters
  protected sources: string[] = []; // FFmpeg inputs

  protected source = '';
  public destination = '';
  protected hwaccelArg = '';

  protected section!: Section;

  // Overlay-class (text) sugar computed in stageBackgroundSugar, routed once the overlay graph is known
  // (buildFilters). Background-class sugar is folded into section.filters directly at staging time.
  private pendingOverlaySugar: Filter[] = [];
  // Top-class sugar (`above: true` graphics, freeze flashes): drawn after the section's authored chain,
  // so an authored mask or text never hides it.
  private pendingTopSugar: Filter[] = [];
  // Count of background-sugar filters prepended to section.filters — the splice point for overlay text
  // in the no-overlay-graph case (text sits above the grade, below the section's authored chain).
  private backgroundSugarCount = 0;
  // Count of footage-edit filters (clip range / ramp / freeze) at the head of section.filters; the
  // reframe scale is spliced right after them. Reset per section with the sugar guard.
  private footageHeadCount = 0;
  // Guards stageBackgroundSugar so it folds the sugar exactly once per section: buildSegment stages it
  // before buildMaps (so overlay base legs pick up the grade), and buildFilters calls it too (a no-op
  // then) so buildFilters stays self-contained when driven directly. Reset per section in hydrate.
  private sugarStaged = false;
  // Extra `-i` inputs sugar lowerings registered (layout panes, kinetic fill textures); numbered after
  // every other input, so they force a `-filter_complex` graph. Reset per section in hydrate.
  private readonly extras = createExtraInputs();
  // The section's emoji images (editor/emoji): set by stageBackgroundSugar, null for a section not staged yet.
  private emojiPlan: EmojiPlan | null = null;

  /** The video encoder name for this platform — `codecConfig.videoCodec` (h264_mediacodec on device) or `h264`. */
  protected videoCodec(): string {
    return resolveVideoCodec(this.project.config);
  }

  /** True when the selected encoder is a hardware one (h264_mediacodec / h264_videotoolbox). */
  protected isHardwareCodec(): boolean {
    return isHardwareCodec(this.project.config);
  }

  /** `-pix_fmt yuv420p` for software encoders; empty for hardware (the filtergraph sets the format). */
  protected pixFmtArg(): string {
    return buildPixFmtArg(this.project.config);
  }

  /** Full `-c:v …` args for re-encoded clips — see `buildVideoEncoderArgs` for the per-encoder rules. */
  protected videoEncoderArgs(): string {
    return buildVideoEncoderArgs(this.project.config);
  }

  /** Rec.709/limited-range colour tags for re-encoded segments — see `buildColorMetadataArgs`. */
  protected colorMetadataArgs(): string {
    return buildColorMetadataArgs(this.project.config, this.project.ffmpegVersion);
  }

  /** Output fps for this segment's `-r` — the director-resolved `videoConfig.fps`, else the default. */
  protected fps(): number {
    return this.project.config.videoConfig?.fps ?? DefaultConfig.FPS;
  }

  // Unwrapped references kept as protected fields so subclasses can access them.
  protected readonly assetManager: AssetManager;
  protected readonly variableManager: VariableManager;
  protected readonly mapManager: MapManager;
  protected readonly filterManager: FilterManager;
  protected readonly formattersManager: FormattersManager;
  protected readonly logger: AbstractLogger;
  protected readonly filesystemAdapter: AbstractFilesystem;

  constructor(
    @inject('project') protected project: Project,
    @inject('template') protected template: Template,
    @inject('segment') protected segment: Segment,
    @inject('SegmentManagersBag') managers: SegmentManagersBag
  ) {
    this.assetManager = managers.assetManager;
    this.variableManager = managers.variableManager;
    this.mapManager = managers.mapManager;
    this.filterManager = managers.filterManager;
    this.formattersManager = managers.formattersManager;
    this.logger = managers.logger;
    this.filesystemAdapter = managers.filesystemAdapter;
    // Output orientation (portrait W:H swap) is resolved once in TemplateDirector.config, not here:
    // a per-segment swap re-applied on the shared project config and alternated portrait/landscape
    // across segments, stretching the recorded clip.
  }

  // Structured-sugar staging is per-section: clear the guard + carried sugar so the next section
  // stages its own look/grade/motion afresh.
  private resetSugarState(): void {
    this.sugarStaged = false;
    this.emojiPlan = null;
    this.pendingOverlaySugar = [];
    this.pendingTopSugar = [];
    this.backgroundSugarCount = 0;
    this.footageHeadCount = 0;
  }

  hydrate = (section: Section): SegmentBuilder => {
    this.section = section;
    this.section.inputs ??= [];

    this.segment.currentSection = this.section;

    // Reset segment state for new section
    this.segment.filtersList = [];
    this.segment.filtersMapList = [];
    this.segment.mapsList = [];
    this.segment.tempFonts = [];
    this.segment.tempLuts = [];
    this.segment.inputsAsset = [];
    this.segment.inputsMapCount = 0;
    this.segment.extraInputs = this.extras.reset();

    this.resetSugarState();

    this.assetManager.segment = this.segment;
    this.mapManager.segment = this.segment;
    this.filterManager.segment = this.segment;
    this.formattersManager.segment = this.segment;

    this.filesystemAdapter.setSegment(this.section.name);

    return this;
  };

  init = async (): Promise<boolean> => {
    this.source = this.filesystemAdapter.getSource();
    this.destination = this.filesystemAdapter.getDestination();

    this.logger.info(`[${this.section.name}][Source] ${this.source}`);
    this.logger.info(`[${this.section.name}][Dest] ${this.destination}`);

    await this.assetManager.setUpPaths();
    this.normalizeBackgroundColor();

    await this.buildSegment();

    this.applyHwaccel();
    this.configure();
    this.logger.info(`[${this.section.name}][Config] finalized`);

    return true;
  };

  private readonly normalizeBackgroundColor = (): void => {
    const opts = this.section.options;

    if (opts?.backgroundColor) {
      opts.backgroundColor = this.formattersManager.formatColor(opts.backgroundColor);
    }
  };

  // Rethrows any failure as a SectionError. Swallowing it left the command at `-version`, so the
  // section rendered nothing and the concat silently dropped it from the final video.
  private readonly buildSegment = async (): Promise<void> => {
    const timer = getPerfTimer();

    try {
      await timer.span('segment:assets', () => this.assetManager.fetchAssets());
      this.logger.info(`[${this.section.name}][Assets] fetched`);

      // Fold background-class sugar (look/grade/motion/layers) into the authored chain BEFORE the maps
      // are built, so an animation/gradient overlay's base leg (which bakes the section filters via
      // `useSectionFilters` during buildMaps) picks up the colour grade and motion.
      this.stageBackgroundSugar();
      await timer.span('segment:staged-media', () => this.prepareStagedMedia());

      await timer.span('segment:maps', () => this.buildMaps());
      this.logger.info(`[${this.section.name}][Maps] built`);

      await timer.span('segment:filters', () => this.buildFilters());
      this.logger.info(`[${this.section.name}][Filters] built`);

      await timer.span('segment:inputs', async () => {
        this.buildInputs();
      });
      this.logger.info(`[${this.section.name}][Inputs] built`);

      await timer.span('segment:fonts', () => this.assetManager.fetchFonts());
      this.logger.info(`[${this.section.name}][Fonts] fetched`);

      await timer.span('segment:luts', () => this.assetManager.fetchLuts());
      this.logger.info(`[${this.section.name}][LUTs] fetched`);

      await this.emojiPlan?.stage(this.filesystemAdapter);
    } catch (error) {
      const failure = new SectionError(this.section.name, error);
      this.logger.error(failure.message);

      throw failure;
    }
  };

  private readonly applyHwaccel = (): void => {
    const hwaccel = this.project.config.hardwareConfig?.hwaccel;

    // Truthy check covers both null and undefined without loose equality (eqeqeq)
    if (hwaccel) {
      this.hwaccelArg = `-hwaccel ${hwaccel}`;
    }
  };

  protected configure = (): void => {};

  getCommand = () => this.command;

  getProject() {
    return this.project;
  }

  buildInputs = (): void => {
    const opts = this.section.options;
    const inputsAsset = this.segment.inputsAsset as unknown as InputsAssetMap;

    if (opts?.backgroundColor) {
      // Guard the RESOLVED color (variables/colorN already substituted by normalizeBackgroundColor):
      // it is interpolated unquoted into the `color=` lavfi source, so whitespace would inject argv.
      // The color fills the frame whether or not assets composite over it — an asset-less solid
      // color_background must still use its own color (not a transparent placeholder, which is white).
      const bgColor = assertSafeArgToken(opts.backgroundColor, 'backgroundColor');
      const scale = this.project.config.videoConfig?.scale?.replace(':', 'x') ?? '';
      const duration = opts.duration ?? '';

      // Manage background color input
      this.sources.push(`-f lavfi -i color=c=${bgColor}:s=${scale}:d=${duration}`);
    }

    for (const value of Object.values(inputsAsset)) {
      // Animation inputs carry their own `-i` (with `-framerate`/`-stream_loop`/`-c:v` flags) and are
      // pushed verbatim; plain media values are bare staged paths wrapped here as a `-i` source token.
      if (value.startsWith('-')) {
        this.sources.push(value);
        continue;
      }

      this.sources.push(`-i ${assertSafeArgToken(value, 'asset source')}`);
    }
  };

  buildMaps = async (): Promise<void> => {
    this.segment.inputsAsset = [];

    const inputsAsset = this.segment.inputsAsset as unknown as InputsAssetMap;
    const inputs = this.section.inputs ?? [];

    // Stream index of each input in section order. The main video sits at `getVideoInputIncrement()`;
    // asset inputs follow it. When the section's base media is itself the leading input — image_background's
    // pictureUrl (and video's videoUrl) are injected by AssetManager.prepareAssets as the first input — that
    // input occupies the base slot, so overlays after it are numbered from there. Otherwise the base is a
    // separate source (color lavfi / useVideoSection) and assets start one slot later. The injected input is
    // recognized by its mark, not its name: an authored input may be named after the section too.
    const baseIsFirstInput = this.assetManager.isBackgroundInput(inputs[0]);
    const firstIndex = this.mapManager.getVideoInputIncrement() + (baseIsFirstInput ? 0 : 1);
    const videoScale = this.project.config.videoConfig?.scale ?? DefaultConfig.SCALE;

    // Extra inputs come after every other one; numbered now, because the first overlay map below
    // already renders the section chain that reads them.
    this.extras.number(this.extraInputsStart(), this.segment.extraInputs);

    const pendingAnimations = this.stageInputs(inputs, firstIndex, inputsAsset);
    const inputIndex = firstIndex + inputs.length;

    // Gradient layers are the BACKGROUND: composite them first (the first overlay bakes the section
    // filters), then the animation overlays on top — so the final mapped pad is an animation overlay,
    // not the gradient (which would otherwise overwrite the output and drop the overlays). The video
    // leg is normalized to the output scale before compositing so full-frame animations fill the frame.
    this.registerEmojiInputs(this.buildGradientLayers(inputIndex, inputsAsset), inputsAsset);

    for (const animation of pendingAnimations) {
      this.mapManager.addAnimationOverlay(animation.input, animation.index, videoScale);
    }

    this.extras.append(inputsAsset);
  };

  // Stage every input as one `-i` in section order (stable stream indices), returning the animation
  // overlays to map later so gradient layers can composite UNDER them.
  private readonly stageInputs = (
    inputs: NonNullable<Section['inputs']>,
    firstIndex: number,
    inputsAsset: InputsAssetMap
  ): Array<{ input: MapAnimationInput; index: number }> => {
    const pendingAnimations: Array<{ input: MapAnimationInput; index: number }> = [];

    for (const [position, input] of inputs.entries()) {
      const source = this.resolveAnimationSource(input);
      // Keyed apart from the inputs: one named after the section would otherwise overwrite its `-i`.
      const key = this.assetManager.isBackgroundInput(input) ? 'background' : `asset_${input.name}`;

      if (source !== undefined) {
        inputsAsset[key] = source;
        pendingAnimations.push({ input: input as MapAnimationInput, index: firstIndex + position });
      }

      if (source === undefined) {
        // Plain staged media (e.g. an image_background picture or a watermark).
        inputsAsset[key] = this.assetManager.fetchCachedMedia(input);
      }
    }

    return pendingAnimations;
  };

  /**
   * Inputs a segment class places ahead of `this.sources` in its command (blank audio, the clip).
   * Default: the blank-audio track color/image backgrounds always prepend.
   */
  protected leadingInputCount(): number {
    return 1;
  }

  // The stream index of the first extra input: the leading inputs, the background-colour source, every
  // section input, then the gradient-layer sources — the exact order buildInputs emits them in.
  private extraInputsStart(): number {
    const background = this.section.options?.backgroundColor ? 1 : 0;
    const gradients = (this.section.options?.layers ?? []).filter((layer) => layer.gradient).length;

    return this.leadingInputCount() + background + (this.section.inputs?.length ?? 0) + gradients;
  }

  // An extra input's `-i` fragment: another section's recorded clip by path, or fetched media
  // (`-loop 1` for a still, so it lasts the whole section).
  // Media the staged sugar asked for: the section's emoji images and its extra inputs (layout panes,
  // fill textures). Both must exist before the maps are built.
  private readonly prepareStagedMedia = async (): Promise<void> => {
    await this.emojiPlan?.prepare(this.filesystemAdapter);
    await this.extras.stage(this.stageExtraInput);
  };

  private readonly stageExtraInput = async (key: string, source: ExtraInputSource): Promise<string> => {
    if ('clip' in source) {
      const clip = this.project.config.userVideoPaths?.[source.clip] ?? this.filesystemAdapter.getSource(source.clip);

      return `-i ${assertSafeArgToken(clip, 'layout clip')}`;
    }

    const media = { name: key, url: source.url };
    await this.assetManager.fetchMedia(media);
    const path = this.assetManager.fetchCachedMedia(media);

    return source.still ? buildSingleFileImageSource(path) : `-i ${assertSafeArgToken(path, 'layout media')}`;
  };

  // A section reading extra inputs needs `-filter_complex` (a `-vf` chain has one input): with no
  // overlay graph, the linear chain becomes the graph's single map from the clip stream.
  private readonly promoteToComplexGraph = (): void => {
    if (this.extras.size === 0 || this.segment.filtersMapList.length > 0 || this.segment.filtersList.length === 0) {
      return;
    }

    this.segment.filtersMapList.push(`[${this.videoInputIndex()}:v]${this.segment.filtersList.join(',')}[composed]`);
    this.segment.mapsList.push('composed');
  };

  // Emoji images (pulled out of the section's text) follow every other input, from stream `firstIndex`.
  private readonly registerEmojiInputs = (firstIndex: number, inputsAsset: InputsAssetMap): void => {
    this.emojiPlan?.register(inputsAsset, firstIndex);
  };

  /**
   * Resolves the `-i` source fragment for an animation input, or undefined when the input is plain
   * media. A single-file animated input (`.apng`/`.webp`/`.gif`/`.webm`) becomes one `-i`.
   */
  private readonly resolveAnimationSource = (input: {
    type?: string;
    url?: string;
    name: string;
  }): string | undefined => {
    // A still-image overlay takes the same overlay path as an animation (positioned/scaled via
    // addAnimationOverlay), differing only in its `-i` source (held with `-loop 1`, not stream-looped).
    if (input.type === 'image') {
      return buildSingleFileImageSource(this.assetManager.fetchCachedMedia(input));
    }

    if (input.type !== 'animation') {
      return undefined;
    }

    const url = input.url ?? '';

    if (url.endsWith('.zip')) {
      // `.zip` frame sequences are unsupported: only single-file animated formats decode on every
      // platform (Node, browser-WASM, on-device) without an extraction step.
      throw new Error(
        `animation "${input.name}": ZIP frame-sequence animations are no longer supported — ` +
          `use a single-file animated format (.apng, .webp, .gif or .webm).`
      );
    }

    if (/\.(apng|webp|gif|webm)$/i.test(url)) {
      return buildSingleFileAnimationSource(input as MapAnimationInput, this.assetManager.fetchCachedMedia(input));
    }

    return undefined;
  };

  /**
   * Compiles each `gradient` background layer (color_background sections) into one lavfi `gradients`
   * input + one overlay map compositing it over the main stream at the layer's x/y, honoring opacity.
   *
   * ORDERING: the first gradient map carries `useSectionFilters`, so the section's authored chain
   * (drawbox/drawtext/etc.) is applied to the main stream BEFORE the gradient is overlaid — i.e. the
   * gradient composites AFTER those filters. The current maps pipeline (one linear chain per map,
   * section filters folded into the first map) forces this overlay-after-filters order; the visual
   * difference is acceptable for v1.
   */
  private readonly buildGradientLayers = (firstGradientIndex: number, inputsAsset: InputsAssetMap): number => {
    const layers = this.section.options?.layers ?? [];
    const scale = this.project.config.videoConfig?.scale ?? DefaultConfig.SCALE;
    const duration = this.section.options?.duration ?? 0;

    let gradientIndex = firstGradientIndex;

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];

      if (!layer.gradient) {
        continue;
      }

      // x/y resolve to pixels here (not in MapManager) because only the builder knows the project
      // scale; the overlay filter itself has no iw/ih variables to evaluate the UI's expressions.
      const geometry = resolveLayerGeometry(layer, scale);
      inputsAsset[`gradient_${i}`] = buildGradientSource(layer, scale, duration);
      this.mapManager.addGradientOverlay(layer, gradientIndex, `gradient_layer_${i}`, `${geometry.x}:${geometry.y}`);
      gradientIndex++;
    }

    return gradientIndex;
  };

  buildFilters = async (): Promise<void> => {
    // Initialize filters if not set
    this.section.maps ??= [];
    this.section.filters ??= [];

    // No-op when buildSegment already staged before buildMaps; folds it now when buildFilters is driven
    // standalone (unit tests) so the linear-chain sugar is present.
    this.stageBackgroundSugar();

    const opts = this.section.options;

    const hasOverlayGraph = this.segment.filtersMapList.length > 0;

    if (!hasOverlayGraph) {
      this.routeSugarIntoLinearChain(this.section.filters);
    }

    // Reframe (cover / letterbox / blur fill, focus), right after the footage edits staged ahead of
    // everything (stageBackgroundSugar): frames are retimed before any of them is scaled or drawn on.
    this.prependScaleFilters(opts);

    // Build simple filters
    for (const filter of this.section.filters) {
      this.segment.filtersList.push(this.filterManager.addFilter(filter));
    }

    // Build map configuration with their filters
    for (const map of this.section.maps) {
      this.mapManager.addMap(map);
      this.segment.inputsMapCount++;
    }

    // Chroma-key composite: keys the section's screen colour out and paints a solid background behind
    // the clip. It builds its own split/overlay graph (no extra input), so the final mapped pad is
    // ck_out and the section's authored chain folds in via the overlay path below.
    this.applyChromakeyComposite();

    // When the section composites an overlay graph (animation/gradient maps), the linear filtersList
    // is ignored — so overlay-class sugar (caption/lowerThird text) is chained ONTO the final map
    // instead, drawing on top of the overlay rather than being dropped.
    this.appendOverlayChain(hasOverlayGraph ? [...this.pendingOverlaySugar, ...this.pendingTopSugar] : []);
    this.promoteToComplexGraph();

    // Colour emoji composite above the text they were pulled out of (editor/emoji).
    this.emojiPlan?.compose(this.segment, this.section.filters, `${this.videoInputIndex()}:v`);

    this.formatFilters();
  };

  // With NO overlay graph, overlay-class (text) sugar is spliced into the linear chain right after the
  // background sugar (above the grade, below the section's authored chain) to preserve the previous draw
  // order, and top-class sugar closes the chain, after the authored masks and filters. With an overlay
  // graph both are chained onto the final composited pad instead (appendOverlayChain).
  private readonly routeSugarIntoLinearChain = (filters: Filter[]): void => {
    if (this.pendingOverlaySugar.length > 0) {
      filters.splice(this.backgroundSugarCount, 0, ...this.pendingOverlaySugar);
    }

    filters.push(...this.pendingTopSugar);
  };

  // Builds the chroma-key split/overlay graph when the section requests it, sizing the clip to the
  // output scale first. No-op otherwise, keeping non-keyed sections byte-identical.
  private readonly applyChromakeyComposite = (): void => {
    if (!this.section.chromaKey) {
      return;
    }

    const videoScale = this.project.config.videoConfig?.scale ?? DefaultConfig.SCALE;
    const head = this.footageHead().map((filter) => this.filterManager.addFilter(filter));
    this.mapManager.addChromakeyComposite(this.section.chromaKey, this.videoInputIndex(), videoScale, head);
  };

  // The footage edits' video head (core/footage/plan.ts), or none for an unedited section.
  private readonly footageHead = (): Filter[] => sectionFootageHead(this.section, this.project.buildInfos, this.fps());

  /**
   * Chains overlay-class sugar (text) onto the final composited pad when the section has an overlay
   * graph. No-op when there is no map (the text was already placed in the linear chain). Routing here
   * — rather than as section filters — keeps the text visible above animation/gradient overlays.
   */
  private readonly appendOverlayChain = (overlayFilters: Filter[]): void => {
    const lastPad = this.segment.mapsList.at(-1);

    if (overlayFilters.length === 0 || lastPad === undefined) {
      return;
    }

    const compiled = overlayFilters.map((filter) => this.filterManager.addFilter(filter)).join(',');
    const outPad = `${this.section.name}_text`;

    this.segment.filtersMapList.push(`[${lastPad}]${compiled}[${outPad}]`);
    this.segment.mapsList.push(outPad);
  };

  // The context each sugar compiler needs to lower time/space-dependent effects (Ken Burns calibrates
  // over the clip length + scale). Real footage drives zoompan one output frame per input frame and
  // calibrates over the clip's TRUE length: project_video clips are usually shorter than their declared
  // options.duration; their probed length is filled into buildInfos.durations by
  // TemplateDirector.calculateTotalLength before segments build, so read it here.
  private readonly sugarContext = (): SugarContext => {
    const scale = this.project.config.videoConfig?.scale ?? DefaultConfig.SCALE;
    const isVideo = this.section.type === 'project_video' || this.section.type === 'video';
    const probedDuration = isVideo ? this.project.buildInfos.durations[this.section.name] : undefined;
    const duration = probedDuration ?? this.section.options?.duration ?? 0;

    const fps = this.project.config.videoConfig?.fps ?? DefaultConfig.FPS;
    const motion = motionSugarContext(this.template.descriptor, this.section.name);

    const platform = this.template.descriptor.global?.platform;
    const masks = compositingContext({
      config: this.project.config,
      features: this.project.engineFeatures,
      extras: this.extras,
      formatColor: this.formattersManager.formatColor,
      warn: (message) => {
        this.logger.warn(`[${this.section.name}]${message}`);
      },
    });
    const sections = this.template.descriptor.sections as SugarContext['sections'];
    const theme = this.template.descriptor.global?.theme;

    return {
      duration,
      scale,
      fps,
      isVideo,
      platform,
      theme,
      motion: { ...motion, resolveText: this.resolveSugarText },
      masks,
      sections,
    };
  };

  // Final text for sugar that lays copy out itself (kinetic): locale, variables, fields, section case.
  private readonly resolveSugarText = (text: Record<string, string | undefined>): string => {
    const raw = text[this.project.config.currentLocale ?? ''] ?? Object.values(text)[0] ?? '';
    const resolved = this.variableManager.mapFields(this.variableManager.mapVariables(raw));
    const options = this.section.options;

    if (options?.upperCase) return resolved.toUpperCase();

    return options?.lowerCase ? resolved.toLowerCase() : resolved;
  };

  /**
   * Folds BACKGROUND-class sugar (layers/motion/grade/look) into the section's authored filter list,
   * ordered by the SUGAR_COMPILERS registry. Runs BEFORE buildMaps so an animation/gradient overlay's
   * base leg — which bakes the section filters via `useSectionFilters` while the maps are assembled —
   * picks up the colour grade and motion. (Previously this ran in buildFilters, AFTER buildMaps, so
   * background sugar was silently dropped on any section compositing an overlay.) The OVERLAY-class
   * (text) sugar is stashed on `pendingOverlaySugar` for buildFilters to route once the overlay graph
   * is known — it draws on top of the composite. Global decorations (whole-video sugar) fan out here
   * too, reusing the same routing and the section's own text formatting.
   */
  private readonly stageBackgroundSugar = (): void => {
    if (this.sugarStaged) {
      return;
    }
    this.sugarStaged = true;
    this.section.filters ??= [];
    const ctx = this.sugarContext();
    const sectionSugar = compileSugarLayers(this.section, ctx);
    const globalSugar = compileGlobalDecorations(this.template.descriptor.global, this.section, ctx);

    const background = [...sectionSugar.background, ...globalSugar.background];
    this.pendingOverlaySugar = [...sectionSugar.overlay, ...globalSugar.overlay];
    this.pendingTopSugar = sectionSugar.top;
    // The authored chain, with an includeText:false camera spliced after its framing (presets/camera.ts).
    const authored = framedCamera(this.section, ctx);

    // Footage edits retime the raw clip first, then the CFR conform + seeded noise (presets/motion-chain.ts).
    const head = this.footageHead();
    this.footageHeadCount = head.length;
    this.section.filters = [
      ...head,
      ...conformMotionChain(
        [...background, ...authored.chain],
        this.template.descriptor,
        this.fps(),
        this.section.name
      ),
    ];
    // Everything ahead of the authored chain (background sugar, plus the CFR conform) — the splice point
    // for overlay text, which must draw after the conform so it animates on the frame grid (and after a
    // framed camera, so it stays steady).
    this.backgroundSugarCount = this.section.filters.length - authored.chain.length + authored.textAt;
    this.stageEmoji(ctx);
  };

  // Pulls colour emoji out of every drawtext (sugar and authored); they come back as image overlays.
  private readonly stageEmoji = (ctx: { scale: string; duration: number; fps: number }): void => {
    const plan = createEmojiPlan({
      global: this.template.descriptor.global,
      section: this.section,
      sugar: ctx,
      locale: this.project.config.currentLocale ?? '',
      substitute: (text) => this.variableManager.mapFields(this.variableManager.mapVariables(text)),
      logger: this.logger,
    });

    this.pendingOverlaySugar = plan.rewrite(this.pendingOverlaySugar);
    this.pendingTopSugar = plan.rewrite(this.pendingTopSugar);
    this.section.filters = plan.rewrite(this.section.filters ?? []);
    this.emojiPlan = plan;
  };

  /**
   * Builds the `-af` argument string for this section's voice preset, audio effect, volume automation
   * and fades, or returns '' if none is configured or the section is muted (processing a silent track
   * is pointless). Delegates to the pure module-level buildAudioFadeArg to keep this class within line
   * limits.
   */
  protected buildAudioFadeArg = (): string => buildAudioFadeArg(this.section.options, false, this.project.config);

  // Default COVER (scale up until the frame is filled, crop the overflow) never stretches a source whose
  // aspect differs from the output; letterbox keeps the whole frame with bars; blur fills the bars with
  // a blurred copy; off skips scaling (utils/reframe.ts).
  private readonly prependScaleFilters = (opts: SectionOptions | undefined): void => {
    const reframe = reframeFilters(opts, {
      scale: this.project.config.videoConfig?.scale ?? '',
      setsar: this.project.config.videoConfig?.setsar,
      fps: this.fps(),
    });

    this.section.filters ??= [];
    this.section.filters.splice(this.footageHeadCount, 0, ...reframe);
  };

  /**
   * Index of the input that carries the video stream this segment encodes. The `-vf` path (below) must
   * map it explicitly — otherwise the segment's trailing `-map 0:a?` disables ffmpeg's automatic stream
   * selection and the filtered video is dropped (audio-only output). Default input 0; segments that
   * prepend a blank-audio input (color/image backgrounds, muted clips) override to shift it.
   */
  protected videoInputIndex(): number {
    return 0;
  }

  // Force Rec.709/limited-range on the segment's final video frames so a malformed source
  // (bt470bg/full-range, the frozen-in-Chrome decode bug) is corrected here; downstream concat-copy,
  // xfade and overlay passes inherit the clean tag. setparams is pixel-neutral metadata, so it is the
  // last node of the chain — appended to the linear `-vf` list, or as a node off the complex graph's
  // final video pad. (The output `-color*` flags are a matrix/range floor for the no-filter case.)
  // The section camera rides just before the tag, so it moves the finished frame.
  private readonly appendColorMetadataFilter = (): void => {
    const tag = [...cameraEndOfChain(this.section, this.sugarContext()), buildColorMetadataFilter()].join(',');

    if (this.segment.filtersMapList.length > 0 && this.segment.mapsList.length > 0) {
      const finalPad = this.segment.mapsList.at(-1);
      this.segment.filtersMapList.push(`[${finalPad}]${tag}[ctag]`);
      this.segment.mapsList.push('ctag');

      return;
    }

    this.segment.filtersList.push(tag);
  };

  private readonly formatFilters = (): void => {
    if (this.segment.filtersList.length === 0) {
      return;
    }

    this.appendColorMetadataFilter();

    if (this.segment.filtersMapList.length > 0) {
      // Multi-pad graph (overlays/animations) → complex filtergraph; its video output is mapped via the
      // final `[pad]` below, so no `-map N:v` is needed here.
      this.filters = ` -filter_complex "${this.segment.filtersMapList.join(';')}" `;
      this.logger.debug(`[${this.section.name}][Filters] ${this.segment.filtersMapList.join(';')}`);
    }

    if (this.segment.filtersMapList.length === 0) {
      // Single linear chain (scale/pad/drawtext/…) → use `-vf`, not `-filter_complex`. They are
      // equivalent here, but the on-device embedded engine can't resolve `drawtext` inside a
      // `-filter_complex` graph ("No such filter: drawtext"), while `-vf` works. The explicit
      // `-map N:v` keeps the filtered video in the output despite the trailing `-map 0:a?`.
      this.filters = ` -vf "${this.segment.filtersList.join(',')}" -map ${this.videoInputIndex()}:v `;
      this.logger.debug(`[${this.section.name}][Filters] ${this.segment.filtersList.join(',')}`);
    }

    // Add final map if present (complex-graph video output pad).
    if (this.segment.mapsList.length > 0) {
      this.filters = `${this.filters} -map [${this.segment.mapsList.at(-1)}] `;
      this.logger.debug(`[${this.section.name}][Maps] ${this.segment.mapsList.join(' ')}`);
    }
  };

  /**
   * Generate blank audio track for concatenation. Falls back to the defaults rather than '' —
   * an empty option value (`anullsrc=channel_layout=:…`) is rejected by ffmpeg outright.
   */
  addBlankAudio = (): string => {
    const channelLayout = this.project.config.audioConfig?.channelLayout ?? DefaultConfig.CHANNEL_LAYOUT;
    const sampleRate = this.project.config.audioConfig?.sampleRate ?? DefaultConfig.SAMPLE_RATE;

    return ' -f lavfi -i anullsrc=channel_layout=' + channelLayout + ':sample_rate=' + sampleRate + ' ';
  };
}

export default SegmentBuilder;
