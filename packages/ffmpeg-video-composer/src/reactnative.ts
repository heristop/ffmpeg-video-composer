// React-Native entry point — runs the core in Hermes, driving the native FFmpeg CLI engine.
// Mirrors browser.ts, swapping the WASM/IndexedDB adapters for the native-engine + expo-file-system
// adapters. The engine (the `leclap-ffmpeg` Expo module) is injected by the app so the core never
// imports Expo/app code.
import 'reflect-metadata';
import { container } from 'tsyringe';
import TemplateDirector from './director/TemplateDirector';
import TemplateConcreteBuilder from './director/TemplateConcreteBuilder';
import FilesystemExpoAdapter from './platform/filesystem/FilesystemExpoAdapter';
import FFmpegDeviceAdapter, { type NativeEngine } from './platform/ffmpeg/FFmpegDeviceAdapter';
import MusicFFmpegAdapter from './platform/ffmpeg/MusicFFmpegAdapter';
import AssetManager from './editor/managers/AssetManager';
import VariableManager from './editor/managers/VariableManager';
import MapManager from './editor/managers/MapManager';
import FilterManager from './editor/managers/FilterManager';
import FormattersManager from './editor/managers/FormatterManager';
import Segment from './core/models/Segment';
import AbstractLogger from './platform/logging/AbstractLogger';
import BrowserEventManager from './platform/BrowserEventManager';
import VideoEditor from './editor/VideoEditor';
import MusicComposer from './editor/MusicComposer';
import AnimationComposer from './editor/AnimationComposer';
import Project from './core/models/Project';
import Template, { assertEffectsResolved } from './core/models/Template';
import type { ProjectConfig, TemplateDescriptor } from './core/types';

class ReactNativeLogger extends AbstractLogger {
  debug(message: string): void {
    console.debug(`[FFmpeg Video Composer] ${message}`);
  }

  info(message: string): void {
    console.info(`[FFmpeg Video Composer] ${message}`);
  }

  warn(message: string): void {
    console.warn(`[FFmpeg Video Composer] ${message}`);
  }

  error(message: string): void {
    console.error(`[FFmpeg Video Composer] ${message}`);
  }
}

let isInitialized = false;

function registerAdapters(logger: AbstractLogger, engine: NativeEngine): void {
  const fileSystem = new FilesystemExpoAdapter();
  const ffmpegAdapter = new FFmpegDeviceAdapter(engine);
  const musicAdapter = new MusicFFmpegAdapter();

  container.registerInstance('logger', logger);
  container.registerInstance('ffmpegAdapter', ffmpegAdapter);
  container.registerInstance('filesystemAdapter', fileSystem);
  container.registerInstance('musicAdapter', musicAdapter);
}

function registerServices(): void {
  container.register('AssetManager', { useClass: AssetManager });
  container.register('VariableManager', { useClass: VariableManager });
  container.register('MapManager', { useClass: MapManager });
  container.register('FilterManager', { useClass: FilterManager });
  container.register('FormattersManager', { useClass: FormattersManager });

  container.registerInstance('eventManager', new BrowserEventManager());

  container.register('VideoEditor', { useClass: VideoEditor });
  container.register('MusicComposer', { useClass: MusicComposer });
  container.register('AnimationComposer', { useClass: AnimationComposer });
  container.register('TemplateConcreteBuilder', { useClass: TemplateConcreteBuilder });
  container.register('TemplateDirector', { useClass: TemplateDirector });
}

function initializePlatform(engine: NativeEngine): void {
  if (isInitialized) {
    return;
  }

  registerAdapters(new ReactNativeLogger(), engine);
  registerServices();
  isInitialized = true;
}

function validateTemplate(template: Template, templateDescriptor: TemplateDescriptor): void {
  const validation = template.setDescriptor(templateDescriptor);

  if (!validation.success) {
    const message = validation.errors?.map((e) => e.message).join(', ') ?? 'Invalid template descriptor';

    throw new Error(`Template validation failed: ${message}`);
  }
}

interface CompilationContext {
  eventManager: BrowserEventManager;
  logger: AbstractLogger;
  ffmpegAdapter: FFmpegDeviceAdapter;
  filesystemAdapter: FilesystemExpoAdapter;
  project: Project;
  template: Template;
}

// DI first, with the browser's manual-instantiation fallback (decorators may be flaky under Metro).
function resolveDirector(ctx: CompilationContext): TemplateDirector {
  try {
    container.resolve(MusicComposer);
    container.resolve(TemplateConcreteBuilder);

    return container.resolve(TemplateDirector);
  } catch {
    const { eventManager, logger, ffmpegAdapter, filesystemAdapter, project, template } = ctx;
    const musicComposer = new MusicComposer(project, template, logger, ffmpegAdapter, filesystemAdapter);
    const variableManager = new VariableManager(template, project);
    const animationComposer = new AnimationComposer({
      project,
      template,
      logger,
      ffmpegAdapter,
      filesystemAdapter,
      variableManager,
    });
    const videoEditor = new VideoEditor(
      project,
      template,
      musicComposer,
      animationComposer,
      logger,
      ffmpegAdapter,
      filesystemAdapter
    );
    const concreteBuilder = new TemplateConcreteBuilder(project, logger, ffmpegAdapter, filesystemAdapter);

    return new TemplateDirector(eventManager, videoEditor, {
      concreteBuilder,
      musicComposer,
      project,
      template,
      logger,
      ffmpegAdapter,
      filesystemAdapter,
    });
  }
}

interface CompilationEvents {
  getError: () => unknown;
  detach: () => void;
}

// Wire progress + error listeners on the event bus; returns the captured-error getter + a detach cleanup.
function wireCompilationEvents(
  eventManager: BrowserEventManager,
  onProgress?: (progress: number) => void
): CompilationEvents {
  const emitter = eventManager.connect();
  let compilationError: unknown = null;
  function onProgressEvent(fraction: unknown): void {
    return onProgress?.(typeof fraction === 'number' ? fraction : 0);
  }

  function onStopped(err: unknown): void {
    compilationError = err;
  }

  emitter.on('task-stopped', onStopped);
  emitter.on('compilation-progress', onProgressEvent);

  return {
    getError: () => compilationError,
    detach: () => {
      emitter.off?.('task-stopped', onStopped);
      emitter.off?.('compilation-progress', onProgressEvent);
    },
  };
}

/**
 * Compile a template entirely on-device. `engine` is the native `leclap-ffmpeg` module (run/probe).
 * Returns the output file path, or null on failure.
 */
export async function compileReactNative(
  projectConfig: ProjectConfig,
  templateDescriptor: TemplateDescriptor,
  engine: NativeEngine,
  onProgress?: (progress: number) => void
): Promise<string | null> {
  assertEffectsResolved(templateDescriptor);
  initializePlatform(engine);

  const ctx: CompilationContext = {
    eventManager: container.resolve<BrowserEventManager>('eventManager'),
    logger: container.resolve<AbstractLogger>('logger'),
    ffmpegAdapter: container.resolve<FFmpegDeviceAdapter>('ffmpegAdapter'),
    filesystemAdapter: container.resolve<FilesystemExpoAdapter>('filesystemAdapter'),
    project: new Project(),
    template: new Template(),
  };

  container.registerInstance('project', ctx.project);
  container.registerInstance('template', ctx.template);
  container.registerInstance('segment', new Segment());

  validateTemplate(ctx.template, templateDescriptor);

  const { getError, detach } = wireCompilationEvents(ctx.eventManager, onProgress);

  const director = resolveDirector(ctx);
  director.config(projectConfig, templateDescriptor);

  try {
    const outputPath = await director.construct();

    if (!outputPath) {
      throw getError() ?? new Error('Video compilation failed — no output generated');
    }

    return outputPath;
  } finally {
    detach();
  }
}

export { default as FFmpegDeviceAdapter, type NativeEngine } from './platform/ffmpeg/FFmpegDeviceAdapter';
export { default as FilesystemExpoAdapter } from './platform/filesystem/FilesystemExpoAdapter';
export type { ProjectConfig, TemplateDescriptor, Section, Filter } from './core/types';
export { isFontRef, type FontRef, type FontInput } from './core/fonts';
export { themeCatalog, resolveTheme, type ThemeCatalog, type ThemeSpec } from './core/theme';

export { EffectReferenceSchema, JsonValueSchema } from './schemas/effect-reference.schema';
export type { EffectReference, JsonValue } from './schemas/effect-reference.schema';
export { EffectSectionSchema } from './schemas/section.schemas';
export type { EffectSection } from './schemas/section.schemas';
export { resolveTemplateEffects } from './core/resolve-template-effects';
export {
  platformCatalog,
  resolvePlatform,
  type DeliveryPlatform,
  type PlatformCatalogEntry,
  type PlatformId,
  type PlatformName,
  type ResolvedPlatform,
  type SafeZone,
} from './core/platforms';
export type {
  EffectRenderResult,
  EffectRenderer,
  ResolveTemplateEffectsOptions,
  ResolvedEffectProvenance,
  ResolvedTemplateEffects,
} from './core/resolve-template-effects';
