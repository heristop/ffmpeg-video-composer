import 'reflect-metadata';
import { container } from 'tsyringe';
import PlatformBridge from './platform/PlatformBridge';
import TemplateDirector from './director/TemplateDirector';
import VideoEditor from './editor/VideoEditor';
import Project from './core/models/Project';
import Template, { assertEffectsResolved } from './core/models/Template';
import Segment from './core/models/Segment';
import type AbstractFilesystem from './platform/filesystem/AbstractFilesystem';
import type AbstractLogger from './platform/logging/AbstractLogger';
import TeeLogAdapter from './platform/logging/TeeLogAdapter';
import { attachCompilationListeners, reportCompileFailure } from './platform/compilation-listeners';
import type { CompileReporter, ProjectConfig, TemplateDescriptor } from './core/types';
import { resetPerfTimer } from './utils/perf-timer';
import { FFmpegDetector } from './platform/ffmpeg/FFmpegDetector';
import { selectVideoCodec } from './platform/ffmpeg/select-video-codec';
import { TemplateValidator } from './services/TemplateValidator';
import type { TemplateDescriptor as SchemaTemplateDescriptor } from './schemas/template.schemas';
import { hasDrawtext } from './services/geometry/drawtext-probe';
import { nodeFontLoader } from './services/geometry/node-geometry';
import { runRenderCheck, type RenderCheckOptions, type RenderedGeometry } from './services/geometry/render-check';
import { prepareRegisteredRender, runCompileEpilogue } from './services/compile-epilogue-node';

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

async function registerAdapters(bridge: PlatformBridge): Promise<void> {
  const fileSystem = await bridge.create('filesystem');
  container.registerInstance('logger', await bridge.create('logger'));
  container.registerInstance('ffmpegAdapter', await bridge.create('ffmpeg'));
  container.registerInstance('filesystemAdapter', fileSystem);
  container.registerInstance('musicAdapter', await bridge.create('music'));
}

async function registerManagers(): Promise<void> {
  const EventManager = (await import('./platform/EventManager')).default;
  container.registerInstance('eventManager', new EventManager());

  const AssetManager = (await import('./editor/managers/AssetManager')).default;
  const VariableManager = (await import('./editor/managers/VariableManager')).default;
  const MapManager = (await import('./editor/managers/MapManager')).default;
  const FilterManager = (await import('./editor/managers/FilterManager')).default;
  const FormattersManager = (await import('./editor/managers/FormatterManager')).default;

  container.register('AssetManager', { useClass: AssetManager });
  container.register('VariableManager', { useClass: VariableManager });
  container.register('MapManager', { useClass: MapManager });
  container.register('FilterManager', { useClass: FilterManager });
  container.register('FormattersManager', { useClass: FormattersManager });
}

async function registerEditorClasses(): Promise<void> {
  const MusicComposer = (await import('./editor/MusicComposer')).default;
  const AnimationComposer = (await import('./editor/AnimationComposer')).default;
  const TemplateConcreteBuilder = (await import('./director/TemplateConcreteBuilder')).default;

  container.register('VideoEditor', { useClass: VideoEditor });
  container.register('MusicComposer', { useClass: MusicComposer });
  container.register('AnimationComposer', { useClass: AnimationComposer });
  container.register('TemplateConcreteBuilder', { useClass: TemplateConcreteBuilder });
  container.register('TemplateDirector', { useClass: TemplateDirector });
}

async function initializePlatform(): Promise<void> {
  if (isInitialized) return;

  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    const bridge = new PlatformBridge();

    await registerAdapters(bridge);

    container.registerInstance('project', new Project());
    container.registerInstance('template', new Template());
    container.registerInstance('segment', new Segment());

    await registerManagers();
    await registerEditorClasses();

    isInitialized = true;
  })();

  return initializationPromise;
}

export async function loadConfig(configPath: string): Promise<TemplateDescriptor> {
  await initializePlatform();

  try {
    const fileSystem = container.resolve<AbstractFilesystem>('filesystemAdapter');
    const content = await fileSystem.read(configPath);

    return JSON.parse(content);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${configPath}: ${error.message}`);
    }

    throw error;
  }
}

// Universal gate for the Node compile path: every descriptor is schema-validated before it reaches
// the director, so a malformed template fails fast with a structured summary instead of failing late
// (or silently rendering wrong) inside the engine. `skipValidation` is a trusted-caller opt-out
// (e.g. a descriptor already validated upstream) — never throws on its own, the throw below is the gate.
function assertValidDescriptor(projectConfig: ProjectConfig, templateDescriptor: TemplateDescriptor): void {
  if (projectConfig.skipValidation) {
    return;
  }

  const validator = new TemplateValidator();
  const validation = validator.validateForRender(templateDescriptor, projectConfig);

  if (!validation.success) {
    throw new Error(validator.getValidationSummary(validation));
  }
}

// Opt-in hardware H.264 encoder selection on the Node path (set FVC_HWENCODE=1). Default is OFF:
// benchmarks showed videotoolbox is SLOWER than libx264 ultrafast on short multi-segment renders
// (per-segment hardware-session setup) and only ~5% faster on heavy single encodes, so auto-on
// regresses the common case (see docs/perf-findings.md). When enabled and the ffmpeg build exposes a
// platform hw encoder, set codecConfig.videoCodec; Project.applyDefault merges per block, so the
// audioCodec default (or the caller's explicit one) survives. An explicit codecConfig.videoCodec
// always wins. Never throws. Node-only; browser/reactnative untouched.
async function autoSelectHardwareEncoder(projectConfig: ProjectConfig, logger: AbstractLogger): Promise<void> {
  if (projectConfig.codecConfig?.videoCodec || !process.env.FVC_HWENCODE) {
    return;
  }

  try {
    const selected = selectVideoCodec(await FFmpegDetector.listEncoders(), process.platform);

    if (!selected) {
      return;
    }

    projectConfig.codecConfig = { ...projectConfig.codecConfig, videoCodec: selected };
    logger.info(`[Encoder] auto-selected hardware encoder ${selected}`);
  } catch (error) {
    logger.info(`[Encoder] hardware encoder probe skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// When a reporter wants log lines, swap the registered logger for a tee that forwards every line to
// `onLog` while still delegating to the base logger, and return a restore() so the original singleton
// is reinstated afterwards (the container is shared across compilations in the same process). No-op
// when there's nothing to forward, so the default path keeps the plain logger.
function installReporterLogger(reporter?: CompileReporter): { logger: AbstractLogger; restore: () => void } {
  const base = container.resolve<AbstractLogger>('logger');

  if (!reporter?.onLog) {
    return { logger: base, restore: () => {} };
  }

  const tee = new TeeLogAdapter(base, reporter.onLog);
  container.registerInstance('logger', tee);

  return { logger: tee, restore: () => container.registerInstance('logger', base) };
}

// The director re-emits whatever a failing step rejected with. A bare string is already the reason;
// JSON-encoding it would hand the host a quoted message.
function asError(failure: unknown): Error {
  if (failure instanceof Error) return failure;

  if (typeof failure === 'string') return new Error(failure);

  return new Error(JSON.stringify(failure));
}

// Resolve the director, run the construction span, and emit the perf report, detaching the progress
// listeners once the compile settles.
async function runConstruction(
  projectConfig: ProjectConfig,
  templateDescriptor: TemplateDescriptor,
  logger: AbstractLogger,
  timer: ReturnType<typeof resetPerfTimer>,
  reporter?: CompileReporter
): Promise<string | null> {
  const director = container.resolve(TemplateDirector).config(projectConfig, templateDescriptor);
  // Subscribe to the director's OWN emitter (the Node EventManager hands out a fresh emitter per
  // connect(), so reconnecting would miss its events) and detach once the compile settles.
  const listeners = attachCompilationListeners(director.events, reporter?.onProgress, reporter?.signal);

  try {
    // Output-is-input guard, FFmpeg version, section cache (services/render-setup-node.ts).
    const context = await prepareRegisteredRender(projectConfig, templateDescriptor);
    const output = await timer.span('compile:total', () => director.construct());

    await runCompileEpilogue({ logger, projectConfig, templateDescriptor, output, reporter, context });

    // The director reports a failed build through `task-stopped` and resolves null; rethrow the cause
    // so compile() hands it to the reporter instead of failing without saying which section broke.
    const failure = listeners.getError();

    if (output === null && failure) {
      throw asError(failure);
    }

    return output;
  } finally {
    listeners.detach();
  }
}

export async function compile(
  projectConfig: ProjectConfig,
  templateDescriptor: TemplateDescriptor,
  reporter?: CompileReporter
): Promise<string | null> {
  let restoreLogger: (() => void) | undefined;

  try {
    assertEffectsResolved(templateDescriptor);
    await initializePlatform();
    const timer = resetPerfTimer();
    const { logger, restore } = installReporterLogger(reporter);
    restoreLogger = restore;

    if (!projectConfig.buildDir) {
      throw new Error('buildDir is required in projectConfig');
    }

    logger.info('Starting compilation', {
      hasUserVideoPaths: Boolean(projectConfig.userVideoPaths),
      videoPaths: projectConfig.userVideoPaths ? Object.keys(projectConfig.userVideoPaths) : 'none',
    });

    assertValidDescriptor(projectConfig, templateDescriptor);

    await autoSelectHardwareEncoder(projectConfig, logger);

    return await runConstruction(projectConfig, templateDescriptor, logger, timer, reporter);
  } catch (error) {
    reportCompileFailure(error, reporter);

    return null;
  } finally {
    restoreLogger?.();
  }
}

// Node entry only, like nodeGeometryWarnings: render the sections holding text through this engine and
// measure their contrast from pixels (services/geometry/render-check.ts). Seconds per call, so opt-in.
export function renderedGeometryWarnings(
  descriptor: SchemaTemplateDescriptor,
  options: RenderCheckOptions = {}
): Promise<RenderedGeometry> {
  const engine = { compile, detect: () => FFmpegDetector.detect(), supportsDrawtext: hasDrawtext };

  return runRenderCheck(descriptor, { ...options, loadFont: options.loadFont ?? nodeFontLoader() }, engine);
}

// Node entry only: frame snapshots and comparisons (services/snapshot-api-node.ts) render through this
// engine's compile(), handed over through the container so the snapshot modules never import this entry.
container.registerInstance('snapshotEngine', { compile });

export { TemplateDirector, VideoEditor };
export { default as FFmpegNodeAdapter } from './platform/ffmpeg/FFmpegNodeAdapter';
export {
  default as FFmpegWasmAdapter,
  FFMPEG_CORE_VERSION,
  type FFmpegCoreLoader,
  type FFmpegCoreTarget,
} from './platform/ffmpeg/FFmpegWasmAdapter';
export { default as FilesystemNodeAdapter } from './platform/filesystem/FilesystemNodeAdapter';
export { default as PinoLogAdapter } from './platform/logging/PinoLogAdapter';
export { default as AbstractFFmpeg } from './platform/ffmpeg/AbstractFFmpeg';
export { default as AbstractFilesystem } from './platform/filesystem/AbstractFilesystem';
export { default as AbstractLogger } from './platform/logging/AbstractLogger';
export { default as AbstractMusic } from './platform/ffmpeg/AbstractMusic';
export { FFmpegDetector, FFmpegAvailability } from './platform/ffmpeg/FFmpegDetector';
export type { FFmpegDetectionResult } from './platform/ffmpeg/FFmpegDetector';
export { Terminal } from './utils/terminal';
export { container };
export {
  FONTS,
  findFont,
  findFontByFile,
  DEFAULT_FONT_ID,
  isFontRef,
  type FontEntry,
  type FontRef,
  type FontInput,
} from './core/fonts';
export { assetBaseUrl, fontAssetUrl, isCatalogAssetPath, musicAssetUrl } from './core/asset-source';
export {
  expandPartials,
  expandPartialsSafe,
  expandPartialsWithRegistry,
  partialsById,
  type PartialExpansion,
} from './core/partials';
export type { ProjectConfig, TemplateDescriptor, CompileReporter, MediaTraits } from './core/types';
export {
  TemplateValidator,
  type ValidationResult,
  type ValidationError,
  type GeometryWarning,
  type FontLoader,
  type MotionWarning,
} from './services/TemplateValidator';
// From the loader module, not the geometry barrel. The barrel statically imports font-metrics, the
// colour math, caption-layout, text-boxes and the rules, so re-exporting through it pulled that whole
// graph back into the eager Node chunk and rolldown reported the sibling `await import('./geometry')`
// in TemplateValidator as INEFFECTIVE_DYNAMIC_IMPORT — the lazy load bought nothing. This module has
// no value imports of its own (only the AbstractFilesystem type), so the deferral survives.
export { createBundledFontLoader } from './services/geometry/bundled-font-loader';
// Node entry only: the bundled-then-catalog font loader and the degrade-on-throw wrapper the CLI and
// the MCP server share. The browser and React-Native entries never see it — it reaches disk and
// network. Its geometry imports are type-only, so the lazy `import('./geometry')` still holds.
export { geometryApproxNote, nodeGeometryWarnings } from './services/geometry/node-geometry';
export { templateFontErrors, type TemplateFontCheckOptions } from './services/html-node/template-fonts-node';
export type { RenderCheckOptions, RenderedGeometry } from './services/geometry/render-check';
export { default as TeeLogAdapter } from './platform/logging/TeeLogAdapter';
export {
  TemplateDescriptorSchema,
  templateDescriptorJsonSchema,
  XFADE_TRANSITIONS,
  AFADE_CURVES,
  LOOK_PRESETS,
  TransitionSchema,
  GlobalAudioSchema,
  GradeSchema,
  MotionEffectSchema,
  BackgroundLayerSchema,
  FramingGuideSchema,
  AudioFadeSchema,
  DuckingSchema,
} from './schemas/template.schemas';
export type {
  Transition,
  GlobalAudio,
  Grade,
  MotionEffect,
  BackgroundLayer,
  FramingGuide,
} from './schemas/template.schemas';
export { OrientationSchema, FontRefSchema, FontInputSchema } from './schemas/global.schemas';
export type { Orientation } from './schemas/global.schemas';
export { CaptureModeSchema } from './schemas/section.schemas';
export type { CaptureMode } from './schemas/section.schemas';

export { EffectReferenceSchema, JsonValueSchema } from './schemas/effect-reference.schema';
export type { EffectReference, JsonValue } from './schemas/effect-reference.schema';
export { EffectSectionSchema } from './schemas/section.schemas';
export type { EffectSection } from './schemas/section.schemas';
export { resolveTemplateEffects } from './core/resolve-template-effects';
export type {
  EffectRenderResult,
  EffectRenderer,
  ResolveTemplateEffectsOptions,
  ResolvedEffectProvenance,
  ResolvedTemplateEffects,
} from './core/resolve-template-effects';
export * from './core/determinism';
export { ENGINE_VERSION } from './core/version';
// Node entry only: digest a rendered file for `leclap verify`.
export { digestRenderedFile } from './services/render-manifest-node';
export * from './core/motion';
export * from './core/platforms';
export * from './core/theme';
// Reference-style analysis (pure) and its Node frame decoder: palette, texture and pacing as a theme.
export * from './core/style';
export {
  analyzeStyleFile,
  extractStyleFrames,
  resolveStyleFfmpeg,
  STYLE_FRAME_WIDTH,
  STYLE_MAX_FRAMES,
  STYLE_SAMPLE_INTERVAL,
  type StyleFrames,
  type StyleFramesOptions,
} from './services/style-frames-node';
export {
  motionTimeline,
  type MotionBox,
  type MotionEvent,
  type MotionKind,
  type MotionTimeline,
  type SectionTimeline,
} from './core/motion/timeline';
export { kineticCatalog, KINETIC_PRESET_DEFAULTS } from './core/kinetic/presets';
export * from './node-extras';
export { layoutKinetic, measureBundled } from './core/kinetic/layout';
