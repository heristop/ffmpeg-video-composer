// Browser entry point - excludes Node.js-specific code
import 'reflect-metadata';
import { container } from 'tsyringe';
import TemplateDirector from './director/TemplateDirector';
import TemplateConcreteBuilder from './director/TemplateConcreteBuilder';
import BrowserFilesystemAdapter from './platform/filesystem/BrowserFilesystemAdapter';
import FFmpegWasmAdapter, { type FFmpegCoreLoader } from './platform/ffmpeg/FFmpegWasmAdapter';
import MusicWasmAdapter from './platform/ffmpeg/MusicWasmAdapter';
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
import { attachCompilationListeners } from './platform/compilation-listeners';
import type { ProjectConfig, TemplateDescriptor } from './core/types';

export interface BrowserCompileOptions {
  /**
   * Loads the ffmpeg.wasm core, for a host that serves it itself; the pinned version from unpkg when
   * omitted. Read once, on the compile that initializes the platform.
   */
  loadFFmpegCore?: FFmpegCoreLoader;
}

class BrowserLogger extends AbstractLogger {
  debug(message: string): void {
    console.debug(`[FFmpeg Video Composer] ${message}`);
  }

  log(message: string): void {
    console.log(`[FFmpeg Video Composer] ${message}`);
  }

  error(message: string): void {
    console.error(`[FFmpeg Video Composer] ${message}`);
  }

  warn(message: string): void {
    console.warn(`[FFmpeg Video Composer] ${message}`);
  }

  info(message: string): void {
    console.info(`[FFmpeg Video Composer] ${message}`);
  }
}

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

async function registerAdapters(logger: AbstractLogger, loadFFmpegCore?: FFmpegCoreLoader): Promise<void> {
  const fileSystem = new BrowserFilesystemAdapter();
  const ffmpegAdapter = new FFmpegWasmAdapter(fileSystem, loadFFmpegCore);

  await ffmpegAdapter.waitForReady();
  logger.info('FFmpeg WASM adapter ready');

  const musicAdapter = new MusicWasmAdapter();

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

  const eventManager = new BrowserEventManager();
  container.registerInstance('eventManager', eventManager);

  container.register('VideoEditor', { useClass: VideoEditor });
  container.register('MusicComposer', { useClass: MusicComposer });
  container.register('AnimationComposer', { useClass: AnimationComposer });
  container.register('TemplateConcreteBuilder', { useClass: TemplateConcreteBuilder });
  container.register('TemplateDirector', { useClass: TemplateDirector });
}

async function initializeBrowserPlatform(loadFFmpegCore?: FFmpegCoreLoader): Promise<void> {
  if (isInitialized) return;

  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      const logger = new BrowserLogger();

      container.registerInstance('logger', logger);

      await registerAdapters(logger, loadFFmpegCore);
      registerServices();

      logger.info('Browser platform initialized');
      isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize browser platform:', error);

      throw error;
    }
  })().catch((error: unknown) => {
    // A failed attempt (the core couldn't load offline, say) mustn't stick until the page reloads: the next
    // compile tries again, with a fresh adapter.
    initializationPromise = null;

    throw error;
  });

  return initializationPromise;
}

function validateTemplate(template: Template, templateDescriptor: TemplateDescriptor): void {
  const templateValidation = template.setDescriptor(templateDescriptor);

  if (!templateValidation.success) {
    const errorMessage = templateValidation.errors?.map((e) => e.message).join(', ') ?? 'Invalid template descriptor';

    throw new Error(`Template validation failed: ${errorMessage}`);
  }
}

// The browser cannot request a TrueType face (Google only serves it woff2, which drawtext cannot read),
// so a font named by family is refused here, before any section is encoded — the staging-time check
// only fires mid-render, and its message never reaches the caller.
function assertFontsResolvable(templateDescriptor: TemplateDescriptor, filesystem: BrowserFilesystemAdapter): void {
  const refs = filesystem.unresolvableFontRefs(templateDescriptor);

  if (refs.length > 0) {
    throw new Error(
      `a font named by family cannot be resolved in the browser (${refs.join(', ')}): Google only serves it ` +
        'woff2, which drawtext cannot read. Use a bundled font id or a .ttf filename instead.'
    );
  }
}

interface ResolvedAdapters {
  eventManager: BrowserEventManager;
  logger: AbstractLogger;
  ffmpegAdapter: FFmpegWasmAdapter;
  filesystemAdapter: BrowserFilesystemAdapter;
  musicAdapter: MusicWasmAdapter;
}

interface CompilationContext extends ResolvedAdapters {
  project: Project;
  template: Template;
}

function resolveDirectorViaDI(): TemplateDirector {
  container.resolve(MusicComposer);
  container.resolve(TemplateConcreteBuilder);
  const director = container.resolve(TemplateDirector);

  console.log('[Browser Compile] Used DI container for instantiation');

  return director;
}

function resolveDirectorManually(ctx: CompilationContext): TemplateDirector {
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

  const director = new TemplateDirector(eventManager, videoEditor, {
    concreteBuilder,
    musicComposer,
    project,
    template,
    logger,
    ffmpegAdapter,
    filesystemAdapter,
  });

  console.log('[Browser Compile] Created instances with manual instantiation');

  return director;
}

function resolveDirector(ctx: CompilationContext): TemplateDirector {
  try {
    return resolveDirectorViaDI();
  } catch (diError) {
    console.warn('[Browser Compile] DI container failed, falling back to manual instantiation:', diError);

    return resolveDirectorManually(ctx);
  }
}

function prepareDirector(ctx: CompilationContext): TemplateDirector {
  const { project, template } = ctx;

  container.registerInstance('project', project);
  container.registerInstance('template', template);
  container.registerInstance('segment', new Segment());

  return resolveDirector(ctx);
}

async function runCompilation(
  projectConfig: ProjectConfig,
  templateDescriptor: TemplateDescriptor,
  ctx: CompilationContext,
  onProgress?: (progress: number) => void
): Promise<string> {
  const director = prepareDirector(ctx);

  const emitter = ctx.eventManager.connect();
  const { getError, detach } = attachCompilationListeners(emitter, onProgress);

  director.config(projectConfig, templateDescriptor);

  try {
    const outputPath = await director.construct();

    if (!outputPath) {
      const compilationError = getError();

      if (compilationError) {
        throw compilationError;
      }

      throw new Error('Video compilation failed - no output generated');
    }

    return outputPath;
  } finally {
    detach();
  }
}

export async function compileBrowser(
  projectConfig: ProjectConfig,
  templateDescriptor: TemplateDescriptor,
  onProgress?: (progress: number) => void,
  options: BrowserCompileOptions = {}
): Promise<string | null> {
  try {
    assertEffectsResolved(templateDescriptor);
    await initializeBrowserPlatform(options.loadFFmpegCore);

    const ctx: CompilationContext = {
      eventManager: container.resolve<BrowserEventManager>('eventManager'),
      logger: container.resolve<AbstractLogger>('logger'),
      ffmpegAdapter: container.resolve<FFmpegWasmAdapter>('ffmpegAdapter'),
      filesystemAdapter: container.resolve<BrowserFilesystemAdapter>('filesystemAdapter'),
      musicAdapter: container.resolve<MusicWasmAdapter>('musicAdapter'),
      project: new Project(),
      template: new Template(),
    };

    validateTemplate(ctx.template, templateDescriptor);
    assertFontsResolvable(templateDescriptor, ctx.filesystemAdapter);

    return await runCompilation(projectConfig, templateDescriptor, ctx, onProgress);
  } catch (error) {
    throw new Error(`Browser video compilation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export {
  default as FFmpegWasmAdapter,
  FFMPEG_CORE_VERSION,
  type FFmpegCoreLoader,
  type FFmpegCoreTarget,
} from './platform/ffmpeg/FFmpegWasmAdapter';
export { default as BrowserFilesystemAdapter } from './platform/filesystem/BrowserFilesystemAdapter';
export { default as AbstractFFmpeg } from './platform/ffmpeg/AbstractFFmpeg';
export { default as AbstractFilesystem } from './platform/filesystem/AbstractFilesystem';
export { default as AbstractLogger } from './platform/logging/AbstractLogger';
export { default as Template } from './core/models/Template';
export { default as Project } from './core/models/Project';
export { default as Segment } from './core/models/Segment';
export type { ProjectConfig, TemplateDescriptor, Variables, Section, Filter } from './core/types';
export { isFontRef, type FontRef, type FontInput } from './core/fonts';
export { container } from 'tsyringe';
export { compileBrowser as compile };

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
