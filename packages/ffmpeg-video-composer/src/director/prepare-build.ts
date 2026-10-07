import type { ProjectBuildInfos, ProjectConfig, Section, TemplateDescriptor, VideoConfig } from '@/core/types';
import { DEFAULT_TRANSITION_DURATION } from '../schemas/effects.schemas';
import { resolveTimeRefs, type TimingOptions } from '@/core/timing/resolve';
import type AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import type Project from '../core/models/Project';
import type Template from '../core/models/Template';
import { tapFFmpegCommands } from '@/core/determinism/command-tap';
import { resolveDeterministic } from '@/core/determinism/contract';
import { resolveFps, resolveOrientationScale } from './resolve-video-config';
import { resolveMotionDescriptor } from '@/core/motion/tokens';
import { effectiveOrientation } from '@/core/platforms';
import { resolveThemeDescriptor } from '@/core/theme/resolve';
import { expandAutoSfx } from '@/core/audio/auto-sfx';
import { assertEffectsResolved, expandPartialsSafe } from '@/core/partials';
import type AbstractLogger from '../platform/logging/AbstractLogger';
import { analyzeTemplateMusic } from './beats-analysis';
import { resolveBuildFormat } from '@/core/formats/resolve';

export { discardOutput, publishOutput, resolveOutputPaths } from './output-staging';
export { qcExpectations } from './qc-expectations';
export { awaitsBeatsAnalysis } from './beats-analysis';
export type { TimingOptions } from '@/core/timing/resolve';

// Per-build preparation the director runs once per compile, kept out of TemplateDirector for its line
// and dependency budgets.

/**
 * The build's video config: orientation swap/square preset (the authored orientation, else the
 * `global.platform` default), then the descriptor's fps.
 */
export function resolveBuildVideoConfig(
  videoConfig: VideoConfig | undefined,
  descriptor: Pick<TemplateDescriptor, 'global'>
): VideoConfig | undefined {
  return resolveFps(
    resolveOrientationScale(videoConfig, effectiveOrientation(descriptor.global)),
    descriptor.global?.fps
  );
}

/**
 * Routes every FFmpeg command of the build through the determinism tap: the deterministic encoder
 * profile unless the host opts out (core/determinism/contract.ts), and a record on
 * `project.ffmpegCommands` for the render manifest. Returns the restore function.
 */
export function recordBuildCommands(adapter: AbstractFFmpeg, project: Project): () => void {
  return tapFFmpegCommands(adapter, {
    deterministic: resolveDeterministic(project.config.deterministic),
    onCommand: (command) => project.ffmpegCommands.push(command),
    intercept: project.commandInterceptor,
  });
}

/**
 * The descriptor a build compiles. Deep-cloned: section.filters are mutated in place during builds
 * (sugar/scale prepend preset filters), so compiling the same descriptor twice would double-apply them
 * (Ken Burns twice, contrast squared). Then `{ type:'partial', ref }` sections are expanded into real
 * sections, the single point where the descriptor used for compilation is set: callers pass the raw
 * descriptor (Node `compile` never validates; the browser path validates into the template but the
 * director overwrites it), so without this every partial — logo bumper, flash-card — is dropped
 * downstream by the rendering-type filter. Idempotent: re-expanding an expanded descriptor is a no-op.
 * Then the requested format's composition (core/formats: `formats[format]` and `$format` values), the
 * FIRST pass before orientation, theme, tokens and time references; then the registered-effects check.
 */
export function expandForBuild(
  descriptor: TemplateDescriptor,
  logger: AbstractLogger,
  format?: string
): ReturnType<typeof assertEffectsResolved> {
  const cloned = structuredClone(descriptor);
  const expansion = expandPartialsSafe(cloned);

  if (!expansion.ok) {
    // Unknown ref: keep the clone (the stray partial is skipped by compileVideoSegments, as before).
    logger.warn(`[Director] partial expansion failed: ${expansion.error.message}`);
  }

  for (const warning of expansion.ok ? (expansion.warnings ?? []) : []) {
    logger.warn(`[Director] ${warning.path}: ${warning.message}`);
  }

  return assertEffectsResolved(resolveBuildFormat(expansion.ok ? expansion.data : cloned, format));
}

/** What the time-reference pass needs from the build: output frame, fps, locale and form fields. */
export function timingOptions(config: ProjectConfig): TimingOptions {
  return {
    scale: config.videoConfig?.scale,
    fps: config.videoConfig?.fps,
    locale: config.currentLocale,
    fields: config.fields,
  };
}

/**
 * The descriptor with every theme token (`$color.*`, `$font.*`) resolved and the theme's motion feel merged
 * into `global.motion` (core/theme), every motion `$token` resolved, travel scaled by `global.motion.energy`
 * (core/motion/tokens.ts), then every time reference ("title.end + 0.2", "beat:12"...) resolved to
 * seconds (core/timing/resolve.ts), then `global.audio.sfx: "auto"` expanded into section sound effects
 * (core/audio/auto-sfx.ts). Lowering only ever sees numbers; a reference that cannot be resolved fails the
 * build here, naming the field, rather than rendering a wrong frame.
 */
export function prepareMotion<T extends { meta?: unknown; global?: unknown; sections?: unknown }>(
  descriptor: T,
  timing: TimingOptions = {}
): T {
  const { descriptor: resolved, issues } = resolveTimeRefs(
    resolveMotionDescriptor(resolveThemeDescriptor(descriptor)),
    timing
  );

  if (issues.length > 0) {
    throw new Error(`Time references: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  }

  return expandAutoSfx(resolved, timing);
}

/**
 * prepareMotion for a template whose `global.beats` awaited a music analysis: the music track (already
 * resolved to a local file) is measured first (director/beats-analysis.ts), then the template's
 * descriptor is replaced by the prepared one.
 */
export async function prepareMeasuredMotion(
  template: Template,
  project: Project,
  timing: TimingOptions
): Promise<void> {
  const measured = await analyzeTemplateMusic(template.descriptor, project.buildInfos.musicPath);

  template.descriptor = prepareMotion(measured, timing);
}

/** Logs which sections the host bound recorded clips to. */
export function logVideoPaths(config: ProjectConfig, logger: AbstractLogger): void {
  const paths = config.userVideoPaths;

  logger.info(
    paths
      ? `TemplateDirector received userVideoPaths for sections: ${Object.keys(paths).join(', ')}`
      : 'TemplateDirector: No userVideoPaths provided in config'
  );
}

type BoundaryTransition = ProjectBuildInfos['transitions'][number];

/** The `transition` a section or the descriptor's `global` declares. */
type DeclaredTransition = Section['transition'];

/**
 * The per-boundary transitions of the N rendering sections (N-1 boundaries, in order). Each boundary
 * takes the transition of the EARLIER section or the global default; it is only a non-cut transition
 * when one is declared. Cut boundaries keep type 'cut' (duration 0 in timeline math).
 */
export function boundaryTransitions(
  segments: readonly Section[],
  globalTransition: DeclaredTransition,
  canCrossfade = true
): BoundaryTransition[] {
  return segments.slice(0, -1).map((segment) => {
    const declared = segment.transition ?? globalTransition;

    // An FFmpeg without a working xfade (Node capability probe) cuts instead of failing the assembly.
    if (!declared || declared.type === 'cut' || !canCrossfade) return { type: 'cut', duration: 0 };

    const duration = declared.duration ?? globalTransition?.duration ?? DEFAULT_TRANSITION_DURATION;

    return { type: declared.type, duration, ease: declared.ease };
  });
}
