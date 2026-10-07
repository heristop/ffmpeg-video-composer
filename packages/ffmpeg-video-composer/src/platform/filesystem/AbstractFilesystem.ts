import { assertSafeSegmentName } from '../../core/arg-guard';
import { fontRefPaths } from '../../core/fonts';

abstract class AbstractFilesystem {
  protected root: string | undefined;
  protected tempDir: string | undefined;
  protected segmentName: string | undefined;
  protected buildDir: string | undefined;
  protected assetsDir: string | undefined;

  abstract getAssetsPath(dir: string): Promise<string>;
  abstract getBuildPath(buildDir: string): Promise<string>;
  abstract getSource(segmentName?: string): string;
  abstract getDestination(): string;
  abstract stat(filePath: string): Promise<boolean>;
  abstract fetch(url: string): Promise<string>;
  abstract write(targetPath: string): Promise<void>;
  abstract writeFile(path: string, data: Uint8Array): Promise<void>;
  abstract append(targetPath: string, file: string): Promise<void>;
  abstract unlink(path: string): Promise<void>;
  abstract read(filePath: string): Promise<string>;
  abstract readFile(filePath: string): Promise<Uint8Array>;
  abstract copy(sourcePath: string, targetPath: string): Promise<void>;
  abstract move(sourcePath: string, targetPath: string): Promise<void>;
  abstract fetchAndRead(url: string, headers?: Record<string, string>): Promise<string>;

  // Whether this platform can download a TrueType face for a `FontRef`. Google keys the CSS response
  // format off the User-Agent, and a browser cannot override that header — so a browser only ever
  // gets woff2, which drawtext cannot read. Platforms that can't send a legacy UA turn this off and
  // the staging ladder fails loudly instead of rendering with the wrong typeface.
  readonly supportsRemoteFonts: boolean = true;

  // The fonts named by family in `descriptor` that this platform cannot resolve (their paths): all of
  // them without remote-font support, none otherwise. The browser entry refuses a template with any,
  // before encoding a single section — the staging-time check only fires mid-render.
  unresolvableFontRefs(descriptor: unknown): string[] {
    return this.supportsRemoteFonts ? [] : fontRefPaths(descriptor);
  }

  // Resolve a font that ships with the package to an absolute local path, or null when the platform
  // doesn't bundle fonts locally. The browser/expo adapters seed fonts through their own asset
  // pipeline (public/ dir, expo assets), so they keep the null default; the Node adapter overrides
  // this to find the .ttf shipped in the package instead of downloading it from Google Fonts.
  resolveBundledFont(_fontFile: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  // Resolve a bundled colour-emoji image (`1f525.png`) to an absolute local path, or null. Same role as
  // resolveBundledFont: the Node adapter finds the creative kit's copy; the browser and Expo hosts
  // stage the set under `/assets/emoji/` instead (scripts/copy-core-assets.ts).
  resolveBundledEmoji(_file: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  // Resolve a previously downloaded font from a cache that OUTLIVES the build directory, or null
  // when the platform keeps no such cache. Together with `cacheFont` this is what makes a second
  // render of the same resolved font work offline — the build dir is wiped between runs, so without
  // it every render re-hits Google and eventually gets rate-limited.
  resolveCachedFont(_fontFile: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  // Copy a freshly staged font into the persistent cache. Best-effort by contract: a cache that
  // cannot be written must never fail the render.
  cacheFont(_fontFile: string, _stagedPath: string): Promise<void> {
    return Promise.resolve();
  }

  // Resolve a music track that ships with the package to an absolute local path, or null when the
  // platform doesn't bundle tracks locally. Same role as resolveBundledFont: the Node adapter finds
  // the .mp3 shipped in the package so `global.music` works without a network download; browser/expo
  // keep the null default (they seed tracks through their own asset pipeline).
  resolveBundledMusic(_musicFile: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  // Resolve a bundled sound effect (the creative kit's library/sfx) to a local path, or null — the
  // caller then downloads it from the asset source. Node overrides; browser/expo keep the default.
  resolveBundledSfx(_sfxFile: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  // Resolve a template asset URL to an already-present local file (under the configured assets dir),
  // or null when there's no local copy — in which case the caller downloads it. Lets renders run
  // offline when their media is staged locally while still fetching remote-only assets. The Node
  // adapter overrides this; browser/expo keep the null default (they seed media via their own
  // pipelines), so media fetching there is unchanged.
  resolveLocalAsset(_url: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  setBuildDir = (buildDir: string) => {
    this.buildDir = buildDir;
  };

  getBuildDir = (): string | undefined => this.buildDir;

  setAssetsDir = (assetsDir: string) => {
    this.assetsDir = assetsDir;
  };

  getAssetsDir = (assetsType: string): string | undefined => `${this.assetsDir}/${assetsType}`;

  getRootDir = (): string | undefined => this.root;

  setSegment = (segmentName: string) => {
    this.segmentName = assertSafeSegmentName(segmentName);
  };

  // Scratch dir for the composers' transient files (tmp_normalize/tmp_video/tmp_anim). `tempDir` is
  // never set by any platform, so fall back to the build dir — always set by setBuildDir and writable
  // — otherwise the path is built as `undefined/tmp_*.mp4` and the step reads a non-existent file.
  getTempDir = () => {
    return this.tempDir ?? this.buildDir;
  };
}

export default AbstractFilesystem;
