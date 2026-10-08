import { inject, injectable } from 'tsyringe';
import type AbstractLogger from '../../platform/logging/AbstractLogger';
import type AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import type { Media, MapAnimationInput, SectionOptions } from '@/core/types';
import type Template from '../../core/models/Template';
import type Segment from '../../core/models/Segment';
import type VariableManager from './VariableManager';
import { lutCubeText } from '../presets/lut-staging';
import { lutFileStem } from '../presets/lut-spec';
import { cutawayMedia } from '../footage/cutaway-media';
import { isBackgroundInput, markBackgroundInput } from '../utils/background-input';
import { fnv1a32 } from '@/core/determinism/hash';
import { generatedImage } from '../presets/generated-images';
import { stageHtmlInput, type HtmlAssetDeps } from '../html/html-input-stage';
import { extensionFromUrl, frameInName, frameInUrl, mediaName } from '../utils/media-naming';
import { findFontByFile, DEFAULT_FONT_WEIGHT, type FontRef } from '@/core/fonts';
import { googleCssUrl, extractTtfUrl, GOOGLE_FONTS_USER_AGENT } from '@/core/google-fonts';
import { fontAssetUrl } from '@/core/asset-source';
import type { FontRequest } from '../../core/models/Segment';

// Back-compat for a raw `.ttf` filename that is neither bundled nor in the catalog: the family is
// guessed from the file stem, as it always was. The guess only holds for single-word families
// (`Roboto-Bold.ttf` → "Roboto", and the weight in the name is ignored) — which is exactly why
// `FontRef` exists. Authoring a font by family should always be preferred over relying on this. A
// `+` in the stem spells a space, as in Google's own URLs (`Rubik+Doodle+Shadow.ttf`).
function legacyRefFromFileName(file: string): FontRef {
  return { family: file.split('-')[0].split('.')[0].replaceAll('+', ' ') };
}

// A face as the error messages name it: `"Bebas Neue" weight 400 italic`.
function describeFace(ref: FontRef): string {
  return `"${ref.family}" weight ${ref.weight ?? DEFAULT_FONT_WEIGHT}${ref.style === 'italic' ? ' italic' : ''}`;
}

// The shared TemplateAssets type declares `inputs` as string[] for legacy reasons,
// but it is used at runtime as a string-keyed cache of staged media paths.
type InputsCache = Record<string, string>;

// A resolved Media with guaranteed name, url, and extension strings.
type ResolvedMedia = {
  name: string;
  url: string;
  extension: string;
};

@injectable()
class AssetManager {
  private readonly fontsInFlight = new Map<string, Promise<void>>();

  constructor(
    @inject('template') private readonly template: Template,
    @inject('VariableManager') private readonly variableManager: VariableManager,

    @inject('segment') public segment: Segment,

    @inject('logger') private readonly logger: AbstractLogger,
    @inject('filesystemAdapter') private readonly filesystemAdapter: AbstractFilesystem
  ) {}

  private get inputsCache(): InputsCache {
    return this.template.assets.inputs as unknown as InputsCache;
  }

  async setUpPaths(): Promise<void> {
    this.segment.assetsDir = await this.filesystemAdapter.getBuildPath('assets');
    this.segment.fontsDir = await this.filesystemAdapter.getBuildPath('fonts');
    this.segment.lutsDir = await this.filesystemAdapter.getBuildPath('luts');
    this.segment.panelsDir = await this.filesystemAdapter.getBuildPath('panels');
  }

  prepareAssets = (): void => {
    const currentSection = this.segment.currentSection;

    if (!currentSection) {
      return;
    }

    const options = currentSection.options as SectionOptions & Record<string, string | undefined>;

    for (const key in options) {
      if (Object.hasOwnProperty.call(options, key) && key.endsWith('Url')) {
        // The section background (e.g. image_background's pictureUrl) is the base layer and must be the
        // first input: image_background loops it with `-loop 1`, which binds to the first `-i`. If an
        // animation overlay precedes it, `-loop 1` lands on an animation `.apng` (whose demuxer has no
        // `loop` option) and the overlays composite onto the wrong base stream.
        // Marked: an authored input may share the section's name (see background-input.ts).
        currentSection.inputs = [
          markBackgroundInput({ name: currentSection.name, url: options[key] ?? '' }),
          ...(currentSection.inputs ?? []),
        ];
      }
    }
  };

  isBackgroundInput = (input: object | undefined): boolean => isBackgroundInput(input);

  fetchAssets = async (): Promise<void> => {
    this.prepareAssets();

    const currentSection = this.segment.currentSection;

    if (!currentSection) {
      return;
    }

    try {
      await Promise.all(
        (currentSection.inputs ?? []).map(async (item) => {
          const animationItem = item as MapAnimationInput;
          await this.fetchSingleAsset(animationItem);
          this.logger.info(`[${currentSection.name}][Assets] ${animationItem.name}`);
        })
      );
      // B-roll cutaway clips are plain media: staged here, read back by the segment (editor/footage/).
      await Promise.all(cutawayMedia(currentSection).map((media) => this.fetchMedia(media)));
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));

      throw error;
    }
  };

  private readonly resolveItemUrl = (item: MapAnimationInput): void => {
    if (!item.url) {
      // If no url filled, use variables
      item.url = `{{ ${item.name} }}`;
    }

    // Map variables
    item.url = this.variableManager.mapVariables(item.url);
  };

  private readonly fetchSingleAsset = async (item: MapAnimationInput): Promise<void> => {
    if (this.inputsCache[item.name]) {
      return;
    }

    // An HTML layer is drawn, not fetched (editor/html): staged under an `html:<hash>` url.
    if (item.type === 'html') {
      await stageHtmlInput(item, this.htmlDeps());

      return;
    }

    this.resolveItemUrl(item);

    // A ref is an http(s) URL, an absolute staged path, or a path relative to assetsDir — all valid.
    // The only invalid case is a `{{ … }}` that never got mapped to a real value.
    if (item.url.includes('{{')) {
      throw new Error(`[${this.segment.currentSection?.name}][Assets] Url for ${item.name} is not valid: ${item.url}`);
    }

    // Single-file media — animations (.apng/.webp/.gif/.webm) are fetched like any other asset.
    await this.fetchMedia(item);
  };

  private readonly htmlDeps = (): HtmlAssetDeps => ({
    filesystem: this.filesystemAdapter,
    logger: this.logger,
    segment: this.segment,
    global: this.template.descriptor.global,
    valueOf: this.variableManager.valueOf,
    stageFont: (request) => this.stageFont(request),
    cache: this.inputsCache,
  });

  fetchFonts = async (): Promise<void> => {
    await Promise.all(this.segment.tempFonts.map((request) => this.stageFont(request)));
  };

  // Requests for the same font that overlap (two HTML layers of a section are staged in parallel) share
  // one staging: a second copy would see the first one half-written through stat and read it as is.
  private stageFont(request: FontRequest): Promise<void> {
    const targetPath = `${this.segment.fontsDir}/${request.file}`;
    const staging =
      this.fontsInFlight.get(targetPath) ??
      this.stageFontOnce(request, targetPath).finally(() => this.fontsInFlight.delete(targetPath));

    this.fontsInFlight.set(targetPath, staging);

    return staging;
  }

  // Stages one font, trying the cheapest source first. Every rung is a real fallback except the last:
  // a font that cannot be staged throws, because a missing font does not stop the render — drawtext
  // simply draws with the wrong face, and the failure only shows up as a visibly wrong video.
  private async stageFontOnce({ file, ref }: FontRequest, targetPath: string): Promise<void> {
    if (await this.stageFontLocally(file, targetPath)) {
      return;
    }

    await this.fetchRemoteFont(file, ref ?? legacyRefFromFileName(file), targetPath);

    // Only an exact face seeds the persistent cache, so the next render skips the network. A legacy
    // filename's face is a guess from its stem (the weight in `Roboto-Bold.ttf` is dropped), and
    // persisting that guess under the file's name would outlive any fix to it.
    if (ref) {
      await this.filesystemAdapter.cacheFont(file, targetPath);
    }
  }

  // The rungs that need no Google lookup, cheapest first. Returns true once the font is in place.
  private async stageFontLocally(file: string, targetPath: string): Promise<boolean> {
    const section = this.segment.currentSection?.name;

    // Reuse an already-downloaded font instead of re-fetching it. This keeps the same font family
    // from being requested once per section, which is what gets Google Fonts to rate-limit.
    if (await this.filesystemAdapter.stat(targetPath)) {
      this.logger.info(`[${section}][Font] cached ${file}`);

      return true;
    }

    // Prefer a font shipped/staged alongside the package (resolved locally on Node) over a network
    // fetch, so renders work offline when assets are pre-staged. Falls through when not present.
    const bundled = await this.filesystemAdapter.resolveBundledFont(file);

    if (bundled) {
      await this.filesystemAdapter.copy(bundled, targetPath);
      this.logger.info(`[${section}][Font] bundled ${file}`);

      return true;
    }

    // A font downloaded by an earlier render. The build dir is wiped between runs, so this cache is
    // what keeps a repeat render of the same resolved font offline.
    const cached = await this.filesystemAdapter.resolveCachedFont(file);

    if (cached && (await this.copyCachedFont(cached, targetPath))) {
      this.logger.info(`[${section}][Font] cache hit ${file}`);

      return true;
    }

    return this.stageCatalogFont(file, targetPath);
  }

  // Best-effort, like writing the cache: an entry that exists but can't be read (a shared cache dir
  // written by another user, a stray directory) falls through to the catalog/download instead of
  // failing the section.
  private async copyCachedFont(cached: string, targetPath: string): Promise<boolean> {
    try {
      await this.filesystemAdapter.copy(cached, targetPath);

      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${this.segment.currentSection?.name}][Font] unreadable cache entry ${cached}: ${reason}`);

      return false;
    }
  }

  // Catalog fonts (premium single-token families Google Fonts can't resolve) are fetched by file
  // name from the asset source (GitHub by default, see asset-source.ts) instead of being bundled.
  // The download seeds the persistent cache too: a published install ships no fonts and every MCP
  // render starts from a fresh build dir, so without it each render would fetch them again.
  private async stageCatalogFont(file: string, targetPath: string): Promise<boolean> {
    if (!findFontByFile(file)) {
      return false;
    }

    const assetUrl = fontAssetUrl(file);
    this.logger.info(`[${this.segment.currentSection?.name}][Font] fetching ${assetUrl}`);

    const downloaded = await this.filesystemAdapter.fetch(assetUrl);
    await this.filesystemAdapter.move(downloaded, targetPath);
    await this.filesystemAdapter.cacheFont(file, targetPath);

    return true;
  }

  // Downloads the face named by `ref` from Google Fonts and stages it.
  private async fetchRemoteFont(file: string, ref: FontRef, targetPath: string): Promise<void> {
    const section = this.segment.currentSection?.name;

    if (!this.filesystemAdapter.supportsRemoteFonts) {
      throw new Error(
        `[${section}][Font] cannot resolve "${ref.family}" on this platform: it cannot request a TrueType face ` +
          `(Google returns woff2, which drawtext cannot read). Bundle the font with the app instead.`
      );
    }

    const fontUrl = extractTtfUrl(await this.fetchFontCss(file, ref));

    if (!fontUrl) {
      throw new Error(
        `[${section}][Font] no TrueType face for ${describeFace(ref)} (staged as ${file}). ` +
          'Check the family name exists on Google Fonts.'
      );
    }

    this.logger.info(`[${section}][Font] fetching ${fontUrl}`);

    const path = await this.filesystemAdapter.fetch(fontUrl);
    await this.filesystemAdapter.move(path, targetPath);
  }

  // Google answers an unknown family, a wrongly-cased one, a weight the family lacks or italic on an
  // upright-only family with HTTP 400, which the Node adapter surfaces as a bare "Request failed with
  // status code 400". Re-raised naming the face, so the error says WHICH font could not be resolved.
  private async fetchFontCss(file: string, ref: FontRef): Promise<string> {
    const section = this.segment.currentSection?.name;
    const url = googleCssUrl(ref);
    this.logger.info(`[${section}][Font] fetching ${url}`);

    try {
      return await this.filesystemAdapter.fetchAndRead(url, { 'User-Agent': GOOGLE_FONTS_USER_AGENT });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      throw new Error(
        `[${section}][Font] Google Fonts could not resolve ${describeFace(ref)} (staged as ${file}): ${reason}. ` +
          'Check the family name (exact case), weight and style exist on Google Fonts.',
        { cause: error }
      );
    }
  }

  // Write `produce()` to `targetPath` unless it is already staged, logging cached/staged under `label`.
  // Returns false only when `produce` yields null (nothing to write). Shared by the LUT and panel
  // generators — both synthesise a build-FS asset on the fly (uniform on Node, Expo and browser/WASM)
  // rather than fetching one, so there are no bundled binary assets to ship per platform.
  private readonly stageGenerated = async (
    targetPath: string,
    name: string,
    label: string,
    produce: () => Uint8Array | null
  ): Promise<boolean> => {
    const section = this.segment.currentSection?.name;

    if (await this.filesystemAdapter.stat(targetPath)) {
      this.logger.info(`[${section}][${label}] cached ${name}`);

      return true;
    }

    const bytes = produce();

    if (!bytes) {
      return false;
    }

    await this.filesystemAdapter.writeFile(targetPath, bytes);
    this.logger.info(`[${section}][${label}] staged ${name}`);

    return true;
  };

  // Stage every LUT referenced by a lut3d look/grade (collected into tempLuts by the FormatterManager):
  // generated presets (optionally strength-blended) and user `.cube` files (presets/lut-staging.ts).
  fetchLuts = async (): Promise<void> => {
    await Promise.all(
      this.segment.tempLuts.map(async (spec) => {
        const file = `${lutFileStem(spec)}.cube`;
        const cube = await lutCubeText(spec, this.readLutSource);
        const staged = await this.stageGenerated(`${this.segment.lutsDir}/${file}`, file, 'LUT', () =>
          cube ? new TextEncoder().encode(cube) : null
        );

        if (!staged) {
          this.logger.error(`[${this.segment.currentSection?.name}][LUT] unknown LUT ${spec}`);
        }
      })
    );
  };

  // A user LUT is read from a local staged copy when present (offline-first, like fetchMedia), else fetched.
  private readonly readLutSource = async (url: string): Promise<string> => {
    const mapped = this.variableManager.mapVariables(url);
    const local = await this.filesystemAdapter.resolveLocalAsset(mapped);

    return this.filesystemAdapter.read(local ?? (await this.filesystemAdapter.fetch(mapped)));
  };

  fetchMedia = async (media: Media, frame = 0): Promise<void> => {
    const { name, url, extension } = this.extractFromMedia(media, frame);
    const cache = this.inputsCache;

    if (cache[url]) {
      return;
    }

    // A `panel:` / `sprite:` URL is a generated image (rounded-rect overlay, fx sprite), not a fetchable
    // asset: build the PNG on the fly and stage it to the build FS (uniform on Node, Expo and
    // browser/WASM), mirroring fetchLuts.
    const generated = generatedImage(url);

    if (generated) {
      const path = `${this.segment.panelsDir}/${generated.name}`;

      await this.stageGenerated(path, generated.name, generated.label, generated.produce);
      cache[url] = path;

      return;
    }

    // Offline-first: use a local copy staged under assetsDir when present, only download otherwise
    // (mirrors bundled fonts/music). Lets renders run without the network for locally-staged media.
    const local = await this.filesystemAdapter.resolveLocalAsset(url);

    if (local) {
      this.logger.info(`[${this.segment.currentSection?.name}][Media] local asset ${name}`);
      cache[url] = local;

      return;
    }

    await this.downloadMedia(name, url, extension);
  };

  private readonly downloadMedia = async (name: string, url: string, extension: string): Promise<void> => {
    this.logger.info(`[${this.segment.currentSection?.name}][Media] fetching asset ${name}`);

    const path = await this.filesystemAdapter.fetch(url);
    // Suffixed by the URL: names are not unique (an input may share its section's name, the background's).
    const targetPath = `${this.segment.assetsDir}/${name}-${fnv1a32(url).toString(36)}.${extension}`;

    await this.filesystemAdapter.move(path, targetPath);

    this.inputsCache[url] = targetPath;
    this.logger.info(`[${this.segment.currentSection?.name}][Media] fetched asset ${name}`);
  };

  fetchCachedMedia = (media: Media, frame = 0): string => {
    const { name, url } = this.extractFromMedia(media, frame);
    const cache = this.inputsCache;

    if (url in cache) {
      return cache[url];
    }

    if (name in cache) {
      return cache[name];
    }

    throw new Error(`No cache found for keys ${url}, ${name}`);
  };

  extractFromMedia = (media: Media, frame = 0): ResolvedMedia => {
    const mediaUrl = media.url ?? '';
    const url = this.variableManager.mapVariables(mediaUrl);

    return {
      name: frameInName(mediaName(media, url, frame), frame),
      url: frameInUrl(url, frame),
      extension: extensionFromUrl(mediaUrl),
    };
  };
}

export default AssetManager;
