// Browser/WASM compilation service backed by the core package.
import 'reflect-metadata';
import { compileBrowser as compile, container } from 'ffmpeg-video-composer/src/browser.ts';
import { FONTS } from '@leclap/creative-kit/fonts';
import BrowserFilesystemAdapter from 'ffmpeg-video-composer/src/platform/filesystem/BrowserFilesystemAdapter.ts';
import type AbstractEventManager from 'ffmpeg-video-composer/src/platform/AbstractEventManager.ts';
import type { ProjectConfig, TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { QualityTier } from 'ffmpeg-video-composer/src/core/encoding.ts';
import { buildConfigOverrides, type VideoConfigOverride } from './compile-config-overrides';
import { type Template } from '@/services/templateService';
import { compilationLogger } from '@/lib/logger';
import { applyVideoEdits, type VideoEdit } from '@/domain/valueObjects/videoEdits';
import { loadSelfHostedCore } from '@/infrastructure/ffmpeg-core';
import { browserMediaService } from '@/services/browserMediaService';
import { materializeTemplateMedia } from '@/application/usecases/materializeTemplateMedia';
import { applyMediaChoices, type MediaChoices } from '@/application/usecases/applyMediaChoices';
import { analyzeMusicInBrowser } from '@/application/usecases/musicBeats';
import { materializeTemplatePartials } from '@/services/templatePartialService';
import { renderQuip } from '@leclap/creative-kit/render-quips';
import { CompileError, classifyCompileFailure } from './compile-failure';
import { createRenderQueue } from './render-queue';

export type { MediaChoices, VideoConfigOverride };

// How often a stopped render repeats its cancel to the engine until the engine gives up.
const CANCEL_NUDGE_MS = 250;

export interface CompilationConfig {
  template: Template;
  formData: Record<string, string>;
  files: File[];
  // Per-clip trim/crop, keyed by project_video section name. Applied client-side (ffmpeg.wasm)
  // before compilation.
  videoEdits?: Record<string, VideoEdit | undefined>;
  // Music and background selections from the Builder Media step.
  mediaChoices?: MediaChoices;
  // Optional render-config override (the builder's "Preview render" path). Left undefined for
  // production compiles, which fall back to the engine defaults.
  videoConfig?: VideoConfigOverride;
  // Optional x264 preset (e.g. 'ultrafast'). The preview passes this so the transition/color encode
  // — which otherwise defaults to the slow 'medium' — keeps the draft fast at native resolution.
  preset?: string;
  // Optional render quality tier (draft/standard/high) — an engine-resolved CRF/bitrate bundle. Left
  // undefined for callers that don't offer the choice, which falls back to the engine's 'standard'.
  qualityTier?: QualityTier;
}

export interface CompilationProgress {
  stage: string;
  percentage: number;
  currentStep: string;
  totalSteps: number;
  currentStepIndex: number;
  estimatedTimeRemaining?: number;
}

export interface CompilationResult {
  blob: Blob;
  url: string;
  size: number;
  duration?: number;
}

class CoreCompilationService {
  private readonly filesystemAdapter = new BrowserFilesystemAdapter();
  private readonly renders = createRenderQueue();

  // Rejects with a CompileError: its failure says why, in terms the interface can translate.
  //
  // `signal` stops this one render (best effort), with the same reach as cancel(): aborted before it
  // starts (or while it waits behind another render), it rejects with a `stopped` failure without
  // touching the filesystem; aborted while staging, it gives up at the next step boundary; aborted while
  // the engine compiles, the director halts at its next segment boundary (a running FFmpeg command
  // finishes first: the engine owns the shared ffmpeg.wasm worker and exposes no way to terminate it).
  // Either way the promise rejects with a CompileError of kind `stopped` and no output is kept.
  compileVideo(
    config: CompilationConfig,
    onProgress: (progress: CompilationProgress) => void,
    signal?: AbortSignal
  ): Promise<CompilationResult> {
    return this.renders.run((isCurrent) => {
      const current = (): boolean => isCurrent() && !signal?.aborted;
      // Only a render still in flight may tell the engine to stop; once a newer render replaced it, the
      // engine is that render's, and this one already gives up at its next checkpoint.
      const onAbort = (): void => {
        if (isCurrent()) this.signalCancel();
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      return this.render(config, onProgress, current).finally(() => {
        signal?.removeEventListener('abort', onAbort);
      });
    });
  }

  private async render(
    config: CompilationConfig,
    onProgress: (progress: CompilationProgress) => void,
    isCurrent: () => boolean
  ): Promise<CompilationResult> {
    // Give up on a render the viewer stopped, or a newer one replaced, before its next step.
    const checkpoint = () => {
      if (!isCurrent()) throw new Error('Render stopped');
    };

    try {
      checkpoint();
      const { projectConfig, templateDescriptor, userVideoPaths } = await this.stage(config, onProgress, checkpoint);

      const outputPath = await this.runCompilation(projectConfig, templateDescriptor, onProgress, isCurrent);
      checkpoint();

      const result = await this.finalizeResult(outputPath, onProgress);

      await this.cleanupFiles(outputPath, userVideoPaths);

      return result;
    } catch (error) {
      // A voided render fails however it happens to stop (at a checkpoint, mid-clip, or at a segment
      // boundary with no output) and none of that is an error: the viewer asked for it.
      if (!isCurrent()) throw new CompileError({ kind: 'stopped', detail: '' }, { cause: error });

      const failure = classifyCompileFailure(error);
      compilationLogger.error(`Compilation error (${failure.kind}):`, error);

      throw new CompileError(failure, { cause: error });
    }
  }

  // Everything the engine needs on disk before it runs: a clean filesystem, the clips (trimmed and
  // cropped) stored under their section names, the project config, the bundled fonts, and the descriptor
  // with its media materialized.
  private async stage(
    config: CompilationConfig,
    onProgress: (progress: CompilationProgress) => void,
    checkpoint: () => void
  ): Promise<{
    projectConfig: ProjectConfig;
    templateDescriptor: TemplateDescriptor;
    userVideoPaths: Record<string, string>;
  }> {
    const { template, formData, files, videoEdits, mediaChoices, videoConfig, preset, qualityTier } = config;

    onProgress({
      stage: 'Initializing',
      percentage: 3,
      currentStep: 'Initializing',
      totalSteps: 7,
      currentStepIndex: 1,
    });

    await this.filesystemAdapter.clear();

    const materializedTemplate = { ...template, descriptor: materializeTemplatePartials(template.descriptor) };
    const clipSectionNames = this.projectVideoSectionNames(materializedTemplate);

    const editedFiles = await this.applyEdits(files, videoEdits, clipSectionNames, onProgress);
    checkpoint();

    const userVideoPaths = await this.storeUploadedFiles(editedFiles, clipSectionNames, onProgress);
    checkpoint();

    const projectConfig = await this.setupProjectConfig(userVideoPaths, formData, onProgress, {
      videoConfig,
      preset,
      qualityTier,
    });

    // Pre-load bundled TTF fonts so drawtext works in WASM: the WASM
    // ffmpeg-core's freetype cannot decode the woff2 that Google Fonts serves
    // ("Could not load font: unimplemented feature"). With the TTF already in
    // place, fetchFonts() finds it cached and skips the (unusable) woff2 fetch.
    await this.preloadBundledFonts();

    const templateDescriptor = this.prepareTemplateDescriptor(
      materializedTemplate,
      formData,
      userVideoPaths,
      onProgress
    );

    await this.prepareMedia(templateDescriptor, mediaChoices);
    checkpoint();

    return { projectConfig, templateDescriptor, userVideoPaths };
  }

  // Stop the render in flight. Its checkpoints give up from here on, and the engine's TemplateDirector,
  // which listens for `task-cancelled` on the shared event manager, halts at the next segment boundary.
  // Safe to call when nothing is running.
  cancel(): void {
    this.renders.stop();
    this.signalCancel();
  }

  private signalCancel(): void {
    try {
      container.resolve<AbstractEventManager>('eventManager').connect().emit('task-cancelled');
    } catch {
      // The engine isn't initialised yet: there is no director to tell, and the checkpoints will do.
    }
  }

  // Bundled TTF fonts (served from /public/fonts) loaded into the build dir so
  // WASM drawtext can use them instead of the unsupported Google-Fonts woff2.
  private async preloadBundledFonts(): Promise<void> {
    const fonts = FONTS.map((f) => f.file);
    const fontsDir = '/tmp/build/fonts';

    await this.filesystemAdapter.ensureDir(fontsDir);
    await Promise.all(
      fonts.map(async (font) => {
        try {
          const response = await fetch(`/fonts/${font}`);

          if (!response.ok) {
            return;
          }

          const data = new Uint8Array(await response.arrayBuffer());
          await this.filesystemAdapter.writeFile(`${fontsDir}/${font}`, data);
        } catch {
          // Best-effort: fall back to the remote font fetch if the bundle is missing.
        }
      })
    );
  }

  // Bundled background track (served from /public/musics) loaded into the assets dir so WASM music
  // mixing finds it locally — mirrors preloadBundledFonts. Without this, a name-only `global.music`
  // has no file to mix and the compile fails (there is no Google-Fonts-style remote fallback).
  private async preloadBundledMusic(descriptor: TemplateDescriptor): Promise<void> {
    const name = descriptor.global?.music?.name;

    if (descriptor.global?.musicEnabled !== true || !name) {
      return;
    }

    const file = name.endsWith('.mp3') ? name : `${name}.mp3`;
    const musicsDir = '/assets/musics';

    try {
      const response = await fetch(`/musics/${file}`);

      if (!response.ok) {
        return;
      }

      await this.filesystemAdapter.ensureDir(musicsDir);
      await this.filesystemAdapter.writeFile(`${musicsDir}/${file}`, new Uint8Array(await response.arrayBuffer()));
    } catch {
      // Best-effort: a missing bundled track just means no music, not a failed render.
    }
  }

  private async applyEdits(
    files: File[],
    videoEdits: Record<string, VideoEdit | undefined> | undefined,
    sectionNames: string[],
    onProgress: (progress: CompilationProgress) => void
  ): Promise<File[]> {
    if (!videoEdits) {
      return files;
    }

    return applyVideoEdits(files, videoEdits, sectionNames, ({ index, total }) => {
      onProgress({
        stage: 'Editing',
        percentage: 5,
        currentStep: `Applying trim/crop to clip ${index + 1} of ${total}`,
        totalSteps: 7,
        currentStepIndex: 1,
      });
    });
  }

  // The ordered `project_video` section names of a template — each user clip maps to one, in order,
  // so clips are stored under the section's real name (e.g. `video_1`, `intro_clip`) rather than a
  // positional `video_N`. This is what the descriptor's `project_video` sections reference.
  private projectVideoSectionNames(template: Template): string[] {
    const sections = (template.descriptor.sections ?? []) as Array<{ name: string; type: string }>;

    return sections.filter((s) => s.type === 'project_video').map((s) => s.name);
  }

  private async storeUploadedFiles(
    files: File[],
    sectionNames: string[],
    onProgress: (progress: CompilationProgress) => void
  ): Promise<Record<string, string>> {
    onProgress({
      stage: 'Preparing',
      percentage: 7,
      currentStep: 'Loading video files into browser storage',
      totalSteps: 7,
      currentStepIndex: 2,
    });

    const entries = files.map((file, i) => {
      const key = sectionNames[i] ?? `video_${i + 1}`;
      const fileName = `${key}.${file.name.split('.').pop() ?? 'mp4'}`;
      const storagePath = `/tmp/${fileName}`;

      return { file, key, storagePath };
    });

    await Promise.all(entries.map(({ file, storagePath }) => this.filesystemAdapter.storeFile(file, storagePath)));

    const userVideoPaths: Record<string, string> = {};

    for (const [i, entry] of entries.entries()) {
      userVideoPaths[entry.key] = entry.storagePath;
      onProgress({
        stage: 'Preparing',
        percentage: 7 + ((i + 1) * 5) / files.length,
        currentStep: `Loaded ${entry.file.name} (${this.formatFileSize(entry.file.size)})`,
        totalSteps: 7,
        currentStepIndex: 2,
      });
    }

    return userVideoPaths;
  }

  private async setupProjectConfig(
    userVideoPaths: Record<string, string>,
    formData: Record<string, string>,
    onProgress: (progress: CompilationProgress) => void,
    overrides: { videoConfig?: VideoConfigOverride; preset?: string; qualityTier?: QualityTier } = {}
  ): Promise<ProjectConfig> {
    onProgress({
      stage: 'Configuring',
      percentage: 11,
      currentStep: 'Setting up project configuration',
      totalSteps: 7,
      currentStepIndex: 3,
    });

    const buildDir = '/tmp/build';
    await this.filesystemAdapter.ensureDir(buildDir);

    // Project merges this over the engine defaults. A `preset` (the preview passes 'ultrafast') routes
    // into hardwareConfig so the transition/color encode skips the slow default 'medium'; `qualityTier`
    // picks the engine's draft/standard/high CRF+bitrate bundle (see resolveTier in encoding.ts).
    return {
      buildDir,
      userVideoPaths,
      fields: formData,
      ...buildConfigOverrides(overrides.videoConfig, overrides.preset, overrides.qualityTier),
    };
  }

  // Apply the user's media choices, then materialize all referenced media into the WASM FS and
  // preload any bundled music so the compile step finds everything on disk.
  private async prepareMedia(
    templateDescriptor: TemplateDescriptor,
    mediaChoices: MediaChoices | undefined
  ): Promise<void> {
    if (mediaChoices) {
      applyMediaChoices(templateDescriptor, mediaChoices);
    }

    // Uploaded music (or a track the library table lacks) gets its beat grid measured here (musicBeats.ts).
    await analyzeMusicInBrowser(templateDescriptor, browserMediaService);
    await materializeTemplateMedia(templateDescriptor, browserMediaService, this.filesystemAdapter);
    await this.preloadBundledMusic(templateDescriptor);
  }

  private prepareTemplateDescriptor(
    template: Template,
    formData: Record<string, string>,
    userVideoPaths: Record<string, string>,
    onProgress: (progress: CompilationProgress) => void
  ): TemplateDescriptor {
    onProgress({
      stage: 'Processing',
      percentage: 14,
      currentStep: 'Parsing template and applying effects',
      totalSteps: 7,
      currentStepIndex: 4,
    });

    const templateDescriptor = this.convertToTemplateDescriptor(template, formData);

    compilationLogger.log('Starting core compilation with:', {
      userVideoPaths: Object.keys(userVideoPaths),
      templateId: template.id,
      formData,
      templateDescriptor,
    });

    return templateDescriptor;
  }

  private async runCompilation(
    projectConfig: ProjectConfig,
    templateDescriptor: TemplateDescriptor,
    onProgress: (progress: CompilationProgress) => void,
    isCurrent: () => boolean
  ): Promise<string> {
    onProgress({
      stage: 'Compiling',
      percentage: 14,
      currentStep: 'Running video processing pipeline',
      totalSteps: 7,
      currentStepIndex: 5,
    });

    // The render is the bulk of the wall-clock time, so it owns most of the bar: map the engine's
    // real-time whole-template progress (0..1) into the 14–95% band, keeping the bar (and the derived
    // step dots) moving for the whole render rather than crawling a thin slice of it. The engine runs
    // on the same self-hosted core as the trim/crop pass, so the two share one download.
    // A Stop pressed while the engine was still loading (the first render fetches the WASM core) had no
    // director to hear it, so keep saying it until the render gives up: a director that hears it before
    // its first segment renders nothing at all.
    const nudge = setInterval(() => {
      if (!isCurrent()) this.signalCancel();
    }, CANCEL_NUDGE_MS);

    const outputPath = await compile(
      projectConfig,
      templateDescriptor,
      (fraction) => {
        // A stopped render reports nothing more.
        if (!isCurrent()) return;

        const clamped = Math.min(Math.max(fraction, 0), 1);
        onProgress({
          stage: 'Compiling',
          percentage: 14 + Math.round(clamped * 81),
          currentStep: renderQuip(clamped),
          totalSteps: 7,
          currentStepIndex: 5,
        });
      },
      { loadFFmpegCore: loadSelfHostedCore }
    ).finally(() => {
      clearInterval(nudge);
    });

    if (!outputPath) {
      throw new Error('Core compilation failed - no output produced');
    }

    onProgress({
      stage: 'Compiling',
      percentage: 95,
      currentStep: 'Core compilation completed',
      totalSteps: 7,
      currentStepIndex: 5,
    });

    return outputPath;
  }

  private async finalizeResult(
    outputPath: string,
    onProgress: (progress: CompilationProgress) => void
  ): Promise<CompilationResult> {
    onProgress({
      stage: 'Finalizing',
      percentage: 97,
      currentStep: 'Retrieving processed video',
      totalSteps: 7,
      currentStepIndex: 6,
    });

    const outputData = await this.filesystemAdapter.readFile(outputPath);
    const blob = new Blob([new Uint8Array(outputData)], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);

    onProgress({
      stage: 'Complete',
      percentage: 100,
      currentStep: 'Video compilation complete!',
      totalSteps: 7,
      currentStepIndex: 7,
    });

    compilationLogger.success('Compilation completed', {
      outputSize: blob.size,
      outputPath,
    });

    return { blob, url, size: blob.size };
  }

  private async cleanupFiles(outputPath: string, userVideoPaths: Record<string, string>): Promise<void> {
    try {
      await Promise.all([
        this.filesystemAdapter.remove(outputPath),
        ...Object.values(userVideoPaths).map((path) => this.filesystemAdapter.remove(path)),
      ]);
    } catch (cleanupError) {
      compilationLogger.warn('Cleanup warning:', cleanupError);
    }
  }

  private convertToTemplateDescriptor(template: Template, formData: Record<string, string>): TemplateDescriptor {
    const templateDescriptor = { ...template.descriptor };

    templateDescriptor.global ??= {};
    templateDescriptor.global.variables ??= {};

    templateDescriptor.global.variables = {
      // Default colors for templates that use them; overridden by any existing
      // variables or form data that follow in the spread.
      color1: 'rgb(255 0 0)',
      color2: 'rgb(250 250 249)',
      ...templateDescriptor.global.variables,
      ...formData,
    };

    compilationLogger.log('Using template descriptor:', {
      templateId: template.id,
      sectionCount: templateDescriptor.sections?.length ?? 0,
      hasMusic: templateDescriptor.global.musicEnabled,
      variables: Object.keys(templateDescriptor.global.variables ?? {}),
    });

    return templateDescriptor;
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async getStorageInfo() {
    return await this.filesystemAdapter.getStorageUsage();
  }

  async clearStorage() {
    await this.filesystemAdapter.clear();
  }
}

export const coreCompilationService = new CoreCompilationService();
