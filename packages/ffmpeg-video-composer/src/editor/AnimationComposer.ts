import { inject, injectable, registry, type DependencyContainer } from 'tsyringe';
import type { GlobalAnimation } from '@/core/types';
import DefaultConfig from '@/core/default.config';
import { buildColorMetadataArgs, buildPixFmtArg, buildVideoEncoderArgs } from '@/core/encoding';
import {
  buildSingleFileAnimationSource,
  buildSingleFileImageSource,
  buildAnimationLegFilters,
  imageOverlayEnable,
  isStillAnimation,
  overlayMotionExpr,
  type OverlayMotion,
  type InternalAnimation,
} from './utils/input-sources';
import { watermarkToAnimation } from './presets/watermark';
import type AbstractLogger from '../platform/logging/AbstractLogger';
import type AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import type AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import type Template from '../core/models/Template';
import type Project from '../core/models/Project';
import type VariableManager from './managers/VariableManager';
import { uniqueTempSuffix } from '../utils/temp-suffix';

export type StagedAnimation = { path: string; anim: InternalAnimation };

type AnimationComposerDeps = {
  project: Project;
  template: Template;
  logger: AbstractLogger;
  ffmpegAdapter: AbstractFFmpeg;
  filesystemAdapter: AbstractFilesystem;
  variableManager: VariableManager;
};

/**
 * Composites the template's whole-video animation overlays (global.animations) over the FINAL joined
 * video, in a single post-concat pass — the visual analog of MusicComposer, which mixes music over the
 * same joined output. Because it runs once on the concatenated `output.mp4` (not per section), the
 * overlays span every section continuously. Called from VideoEditor.finalize BEFORE music, so music's
 * stream-copy of the video carries the overlaid frames.
 */
@registry([
  {
    token: 'AnimationComposerDeps',
    useFactory: (c: DependencyContainer): AnimationComposerDeps => ({
      project: c.resolve<Project>('project'),
      template: c.resolve<Template>('template'),
      logger: c.resolve<AbstractLogger>('logger'),
      ffmpegAdapter: c.resolve<AbstractFFmpeg>('ffmpegAdapter'),
      filesystemAdapter: c.resolve<AbstractFilesystem>('filesystemAdapter'),
      variableManager: c.resolve<VariableManager>('VariableManager'),
    }),
  },
])
@injectable()
class AnimationComposer {
  private readonly project: Project;
  private readonly template: Template;
  private readonly logger: AbstractLogger;
  private readonly ffmpegAdapter: AbstractFFmpeg;
  private readonly filesystemAdapter: AbstractFilesystem;
  private readonly variableManager: VariableManager;

  constructor(@inject('AnimationComposerDeps') deps: AnimationComposerDeps) {
    this.project = deps.project;
    this.template = deps.template;
    this.logger = deps.logger;
    this.ffmpegAdapter = deps.ffmpegAdapter;
    this.filesystemAdapter = deps.filesystemAdapter;
    this.variableManager = deps.variableManager;
  }

  // A `global.watermark`, when set, is prepended so an explicit `global.animations` entry still
  // composites on top of it (the watermark becomes the base every explicit animation overlays over).
  // watermarkToAnimation is pure sugar: it returns the SAME GlobalAnimation shape, so every step below
  // (staging, buildOverlaySources, buildOverlayGraph) treats it exactly like an authored entry — the
  // only extra knowledge here is the output scale it needs to resolve a fractional width into pixels.
  private animations(): InternalAnimation[] {
    const global = this.template.descriptor.global;
    const raw = global?.animations ?? [];

    if (!global?.watermark) {
      return raw;
    }

    const outputScale = this.project.config.videoConfig?.scale ?? DefaultConfig.SCALE;

    return [watermarkToAnimation(global.watermark, outputScale), ...raw];
  }

  /**
   * Resolve each whole-video animation to a local file path — offline-first via resolveLocalAsset
   * (a copy staged under assetsDir), else download. Mirrors AssetManager.fetchMedia / MusicComposer,
   * so `{{ var }}` urls and bundled `/assets/animations/x.apng` paths both work cross-platform.
   */
  loadAnimations = async (): Promise<StagedAnimation[]> => {
    const animations = this.animations();

    if (animations.length === 0) {
      return [];
    }

    const buildAssetsDir = await this.filesystemAdapter.getBuildPath('assets');

    return Promise.all(
      animations.map(async (anim) => {
        const url = this.variableManager.mapVariables(anim.url);
        const path = await this.stageAnimation(url, buildAssetsDir);

        return { path, anim };
      })
    );
  };

  private async stageAnimation(url: string, buildAssetsDir: string): Promise<string> {
    const local = await this.filesystemAdapter.resolveLocalAsset(url);

    if (local) {
      this.logger.info(`[Animation] local asset ${url}`);

      return local;
    }

    this.logger.info(`[Animation] fetching ${url}`);
    const fetched = await this.filesystemAdapter.fetch(url);
    const name = url.split('/').at(-1) ?? 'animation';
    const target = `${buildAssetsDir}/${name}`;
    await this.filesystemAdapter.move(fetched, target);

    return target;
  }

  /**
   * Overlay the staged animations over `finalVideo`, in place (move aside → single ffmpeg pass →
   * cleanup), the same shape MusicComposer.appendMusic uses. Video is re-encoded (overlay can't
   * stream-copy); the joined video's audio is copied through when present.
   */
  appendAnimations = async (finalVideo: string): Promise<void> => {
    const staged = await this.loadAnimations();

    if (staged.length === 0) {
      return;
    }

    const temp = `${this.filesystemAdapter.getTempDir()}/tmp_anim_${uniqueTempSuffix()}.mp4`;
    await this.filesystemAdapter.move(finalVideo, temp);

    // The joined output may have no audio (e.g. a video-only upload); probe so the map below
    // doesn't reference a missing `[0:a]`. The probed duration is the safety ceiling for finite
    // loop-counts so an over-long looped overlay can't lengthen the output past the video.
    const infos = await this.ffmpegAdapter.getInfos(temp);
    const hasAudio = infos.audioCodec !== null;
    const baseDuration = infos.duration ?? undefined;

    const command = this.buildCommand(temp, staged, finalVideo, hasAudio, baseDuration);
    this.logger.debug(`[Animation][Command] ffmpeg ${command}`);

    const result = await this.ffmpegAdapter.execute(command);
    this.logger.info(`[Animation] ffmpeg process exited with rc ${result.rc}`);

    if (result.rc === 1) {
      this.project.errors.push('animations');

      throw new Error('Error on animation overlay');
    }

    await this.filesystemAdapter.unlink(temp);
  };

  // The `-i` source args for the staged animations (loop/offset/duration flags), bounded by
  // maxDuration so an over-long loop can't lengthen the output. Shared by the standalone overlay
  // command and the fused transition+overlay assembly (VideoEditor). A still image (isStillAnimation)
  // gets the SAME `-loop 1` source the section path uses (buildSingleFileImageSource) instead of
  // being stream-looped as if it were an animated format — its own start/duration are NOT applied
  // here (no -itsoffset/-t/maxDuration ceiling); they lower to an overlay `enable=` gate instead, in
  // buildOverlayGraph, because the still's `-loop 1` source is always infinite and the video-global
  // `t` the post-concat overlay sees is the natural place to bound a still's show window.
  buildOverlaySources(staged: StagedAnimation[], maxDuration?: number): string {
    return staged
      .map(({ anim, path }) =>
        isStillAnimation(anim, path)
          ? buildSingleFileImageSource(path)
          : buildSingleFileAnimationSource({ url: anim.url, options: anim }, path, { maxDuration })
      )
      .join(' ');
  }

  private buildCommand(
    temp: string,
    staged: StagedAnimation[],
    finalVideo: string,
    hasAudio: boolean,
    baseDuration?: number
  ): string {
    const sources = this.buildOverlaySources(staged, baseDuration);

    const filterComplex = this.buildFilterComplex(staged);
    const encoderArgs = buildVideoEncoderArgs(this.project.config);
    const pixFmtArg = buildPixFmtArg(this.project.config);
    const colorArgs = buildColorMetadataArgs(this.project.config, this.project.ffmpegVersion);
    const audioMap = hasAudio ? ' -map 0:a -c:a copy ' : ' ';

    return (
      ` -y -i ${temp} ${sources} ` +
      ` -filter_complex "${filterComplex}" ` +
      ` -map "[vout]"${audioMap}${encoderArgs} ${pixFmtArg} ${colorArgs} -movflags +faststart ${finalVideo} `
    );
  }

  /**
   * Per animation k (input index k+1): scale/fade its leg, then chain `overlay` over the running base
   * (`[0:v]` first, the prior overlay output after). `shortest=1` on a looping overlay bounds the
   * output to the video; `eof_action` freezes (persistent) or shows the video through (default) once a
   * non-looping overlay ends.
   */
  private buildFilterComplex(staged: StagedAnimation[]): string {
    return this.buildOverlayGraph(staged, {});
  }

  /**
   * Build the overlay filtergraph: each animation's leg (scale/rotate/opacity) overlaid over a running
   * base. Parameterized so it works both standalone (base `[0:v]`, the joined video as input 0) and
   * fused into the transition assembly (base = the xfade output label, animation inputs offset past
   * the segment inputs, a distinct chain prefix to avoid colliding with the xfade's `[v{k}]` labels).
   * Defaults reproduce the standalone command byte-for-byte.
   */
  buildOverlayGraph(
    staged: StagedAnimation[],
    opts: { baseLabel?: string; firstInputIndex?: number; chainPrefix?: string; outLabel?: string }
  ): string {
    const firstInputIndex = opts.firstInputIndex ?? 1;
    const chainPrefix = opts.chainPrefix ?? 'v';
    const outLabel = opts.outLabel ?? '[vout]';

    const legs: string[] = [];
    const overlays: string[] = [];
    let base = opts.baseLabel ?? '[0:v]';

    for (const [k, { anim, path }] of staged.entries()) {
      // An optional `motion` animates the entrance, same lowering as the per-section overlay
      // (MapManager.addAnimationOverlay): slide/rise emit overlay x/y time expressions easing back to
      // the static position; fade adds an alpha fade-in to the overlay leg. All LGPL-safe (fade/format/overlay).
      const motion = overlayMotionExpr(anim.motion, anim.position ?? '0:0');
      const legRef = this.appendOverlayLeg(anim, firstInputIndex + k, k, legs, motion);
      const out = k === staged.length - 1 ? outLabel : `[${chainPrefix}${k}]`;

      // Moving entrances use the named, single-quoted overlay form so the comma-bearing time
      // expressions are not mis-parsed as extra filter options; otherwise the static positional form.
      const placement = motion.x || motion.y ? `x='${motion.x}':y='${motion.y}'` : (anim.position ?? '0:0');

      // A still image's start/duration never reach its `-loop 1` source (buildOverlaySources), so they
      // lower here to the overlay filter's own timeline support instead — the same imageOverlayEnable
      // expression the per-section overlay uses, just against the video-global `t` this pass sees.
      const timeline = isStillAnimation(anim, path)
        ? imageOverlayEnable({ start: anim.start, duration: anim.duration })
        : '';

      overlays.push(`${base}${legRef}overlay=${placement}:eof_action=${this.overlayEof(anim, path)}${timeline}${out}`);
      base = `[${chainPrefix}${k}]`;
    }

    return [...legs, ...overlays].join(';');
  }

  // Push the per-animation leg (scale/rotate/opacity, plus a fade motion's alpha fade-in) when any
  // filter applies and return the label the overlay should consume — the padded leg output, or the
  // raw input stream when no leg filters apply.
  private appendOverlayLeg(
    anim: GlobalAnimation,
    inputIndex: number,
    k: number,
    legs: string[],
    motion: OverlayMotion
  ): string {
    const legFilters = buildAnimationLegFilters({
      scale: anim.scale,
      fit: anim.fit,
      flip: anim.flip,
      rotation: anim.rotation,
      opacity: anim.opacity,
    });

    // The fade filter's alpha ramp needs an alpha-capable frame; reuse the leg's rgba conversion
    // when the opacity/rotate path already added one (same guard as MapManager.addAnimationOverlay).
    if (motion.legFilter) {
      if (!legFilters.includes('format=rgba')) {
        legFilters.push('format=rgba');
      }

      legFilters.push(motion.legFilter);
    }

    if (legFilters.length === 0) {
      return `[${inputIndex}:v]`;
    }

    const pad = `[anim${k}]`;
    legs.push(`[${inputIndex}:v]${legFilters.join(',')}${pad}`);

    return pad;
  }

  // eof_action + optional `:shortest=1`. shortest bounds any INFINITE source to the base video:
  // the legacy `loop:true` animation case, and every still image — a still's `-loop 1` source
  // (buildOverlaySources) is always infinite (its start/duration lower to the enable gate above
  // instead of an input `-t`), so it always needs the same terminator or the overlay — and the
  // whole encode, since this pass has no output `-t` of its own — would never reach EOF.
  private overlayEof(anim: InternalAnimation, path: string): string {
    const eofAction = anim.persistent ? 'repeat' : 'pass';
    const infiniteLoop =
      isStillAnimation(anim, path) || (anim.loop === true && anim.loops === undefined && anim.duration === undefined);

    return infiniteLoop ? `${eofAction}:shortest=1` : eofAction;
  }

  // Fused transition+overlay assembly: the `-i` sources + the overlay graph chaining off the xfade
  // output (`[vfx]`), with animation inputs offset past the segment inputs and an `ov` chain prefix so
  // the labels never collide with the xfade `[v{k}]` chain. Used by VideoEditor.assembleWithTransitions.
  buildFusedOverlay(
    staged: StagedAnimation[],
    opts: { inputOffset: number; maxDuration: number }
  ): { sources: string; graph: string } {
    return {
      sources: this.buildOverlaySources(staged, opts.maxDuration),
      graph: this.buildOverlayGraph(staged, {
        baseLabel: '[vfx]',
        firstInputIndex: opts.inputOffset,
        chainPrefix: 'ov',
        outLabel: '[vout]',
      }),
    };
  }
}

export default AnimationComposer;
