// Browser entry point - excludes Node.js-specific code
import 'reflect-metadata';
import type { FFmpegCoreLoader } from './platform/ffmpeg/FFmpegWasmAdapter';
import type { ProjectConfig, TemplateDescriptor } from './core/types';
import type { HtmlWasmLoader } from './core/html/html-engine';
import type { HtmlLayerPreview, HtmlLayerPreviewRequest } from './services/html-raster/html-layer-preview';

export interface BrowserCompileOptions {
  /**
   * Loads the ffmpeg.wasm core, for a host that serves it itself; the pinned version from unpkg when
   * omitted. Read once, on the compile that initializes the platform.
   */
  loadFFmpegCore?: FFmpegCoreLoader;
  /**
   * Loads the HTML layer rasteriser's WebAssembly (resvg.wasm, hb-subset.wasm, hb.wasm), which the host serves
   * itself; the engine fetches none from a third party. Without it, a template with an HTML layer fails
   * validation with html_unavailable.
   */
  loadHtmlWasm?: HtmlWasmLoader;
}

// The render graph (director, editor, managers) lives in its own lazily loaded chunk: importing the
// entry for its models, schemas or catalogs never pays for it.
export async function compileBrowser(
  projectConfig: ProjectConfig,
  templateDescriptor: TemplateDescriptor,
  onProgress?: (progress: number) => void,
  options: BrowserCompileOptions = {}
): Promise<string | null> {
  try {
    const { runBrowserCompilation } = await import('./browser-compile');

    return await runBrowserCompilation(projectConfig, templateDescriptor, onProgress, options);
  } catch (error) {
    throw new Error(`Browser video compilation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Draws one HTML layer as a render would (the builder's live preview); the rasteriser loads on first use, from
 * `options.loadHtmlWasm` (required: without it the preview rejects).
 */
export async function renderHtmlLayerPreview(
  request: HtmlLayerPreviewRequest,
  options: Pick<BrowserCompileOptions, 'loadHtmlWasm'> = {}
): Promise<HtmlLayerPreview> {
  const { previewHtmlLayerInBrowser } = await import('./platform/html/html-rasteriser-browser');

  return previewHtmlLayerInBrowser(request, options.loadHtmlWasm);
}

export type { HtmlLayerPreview, HtmlLayerPreviewRequest, HtmlWasmLoader };
export type { HtmlLayerFinding } from './services/html-raster/html-layer-findings';

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
export { themeCatalog, resolveTheme, type ThemeCatalog, type ThemeSpec } from './core/theme';
export { container } from 'tsyringe';
export { compileBrowser as compile };

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
