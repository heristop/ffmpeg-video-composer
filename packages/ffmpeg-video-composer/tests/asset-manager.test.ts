import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AssetManager from '@/editor/managers/AssetManager';
import type { Media, Section } from '@/core/types';
import type { FontRequest } from '@/core/models/Segment';
import { isBackgroundInput } from '@/editor/utils/background-input';

// ---------------------------------------------------------------------------
// AssetManager performs network/fs work through the injected filesystem adapter
// and a VariableManager. We instantiate it directly with mock collaborators so
// no real fetch/fs happens.
// ---------------------------------------------------------------------------

function createFilesystem() {
  return {
    getBuildPath: vi.fn(async (dir: string) => `/build/${dir}`),
    stat: vi.fn(async () => false),
    fetch: vi.fn(async (_url: string) => '/tmp/downloaded'),
    move: vi.fn(async () => undefined),
    copy: vi.fn(async () => undefined),
    fetchAndRead: vi.fn(async () => ''),
    writeFile: vi.fn(async (_path: string, _bytes: Uint8Array) => undefined),
    // Default to "not bundled" so these tests still exercise the Google Fonts download path.
    resolveBundledFont: vi.fn(async (): Promise<string | null> => null),
    // Default to "not cached" so these tests still exercise the download path.
    resolveCachedFont: vi.fn(async (): Promise<string | null> => null),
    cacheFont: vi.fn(async () => undefined),
    supportsRemoteFonts: true,
    // Default to "no local copy" so media tests still exercise the download path.
    resolveLocalAsset: vi.fn(async (): Promise<string | null> => null),
  };
}

function createLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function build(
  opts: {
    section?: Section;
    inputsCache?: Record<string, string | string[]>;
    fonts?: Record<string, string>;
    fs?: ReturnType<typeof createFilesystem>;
    mapVariables?: (v: string) => string;
  } = {}
) {
  const template = {
    descriptor: {},
    assets: {
      fonts: opts.fonts ?? {},
      musics: {},
      inputs: opts.inputsCache ?? {},
    },
  };
  const variableManager = {
    mapVariables: vi.fn(opts.mapVariables ?? ((v: string) => v)),
    mapFields: vi.fn((v: string) => v),
  };
  const segment = {
    currentSection: opts.section,
    assetsDir: '/assets',
    fontsDir: '/fonts',
    tempFonts: [] as FontRequest[],
    lutsDir: '/luts',
    tempLuts: [] as string[],
    panelsDir: '/panels',
    inputsMapCount: 0,
    mapsList: [] as string[],
  };
  const logger = createLogger();
  const fs = opts.fs ?? createFilesystem();

  const manager = new AssetManager(template as any, variableManager as any, segment as any, logger as any, fs as any);

  return { manager, template, variableManager, segment, logger, fs };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AssetManager.setUpPaths', () => {
  it('resolves the assets, fonts, luts and panels directories', async () => {
    const { manager, segment, fs } = build();
    await manager.setUpPaths();
    expect(segment.assetsDir).toBe('/build/assets');
    expect(segment.fontsDir).toBe('/build/fonts');
    expect(segment.lutsDir).toBe('/build/luts');
    expect(segment.panelsDir).toBe('/build/panels');
    expect(fs.getBuildPath).toHaveBeenCalledTimes(4);
  });
});

describe('AssetManager.prepareAssets', () => {
  it('does nothing when there is no current section', () => {
    const { manager } = build({ section: undefined });
    expect(() => manager.prepareAssets()).not.toThrow();
  });

  it('collects every option key ending in Url into section inputs', () => {
    const section = {
      name: 'intro',
      type: 'video',
      options: { videoUrl: 'http://a/v.mp4', logoUrl: 'http://a/logo.png', duration: 5 },
    } as unknown as Section;
    const { manager } = build({ section });
    manager.prepareAssets();
    const inputs = section.inputs as unknown as Array<{ name: string; url: string }>;
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => i.url)).toContain('http://a/v.mp4');
    expect(inputs.map((i) => i.url)).toContain('http://a/logo.png');
  });

  it('defaults an undefined Url option to empty string', () => {
    const section = {
      name: 'intro',
      type: 'video',
      options: { videoUrl: undefined },
    } as unknown as Section;
    const { manager } = build({ section });
    manager.prepareAssets();
    const inputs = section.inputs as unknown as Array<{ url: string }>;
    expect(inputs[0].url).toBe('');
  });

  it('places the section background (*Url) input before existing animation inputs', () => {
    // image_background loops the picture with `-loop 1`, which binds to the FIRST input; the picture
    // must therefore precede animation overlays, otherwise `-loop 1` lands on an animation `.apng`
    // (whose demuxer has no `loop` option) and the overlays composite onto the wrong base stream.
    const section = {
      name: 'hero',
      type: 'image_background',
      options: { pictureUrl: 'pictures/bg.png', duration: 2 },
      inputs: [
        { name: 'shine', url: 'shine.apng', type: 'animation' },
        { name: 'border', url: 'border.apng', type: 'animation' },
      ],
    } as unknown as Section;
    const { manager } = build({ section });
    manager.prepareAssets();
    const inputs = section.inputs as unknown as Array<{ name: string; url: string }>;
    expect(inputs[0].url).toBe('pictures/bg.png');
    expect(inputs.map((i) => i.name)).toEqual(['hero', 'shine', 'border']);
  });

  it('marks the injected background so an input named after the section is not mistaken for it', () => {
    const section = {
      name: 'badge',
      type: 'image_background',
      options: { pictureUrl: 'pictures/bg.png', duration: 2 },
      inputs: [{ name: 'badge', url: 'pictures/logo.png', type: 'image' }],
    } as unknown as Section;
    const { manager } = build({ section });
    manager.prepareAssets();
    const inputs = section.inputs ?? [];
    expect(inputs.map((input) => isBackgroundInput(input))).toEqual([true, false]);
  });
});

describe('AssetManager.fetchAssets', () => {
  it('returns early when there is no current section', async () => {
    const { manager, fs } = build({ section: undefined });
    await manager.fetchAssets();
    expect(fs.fetch).not.toHaveBeenCalled();
  });

  it('fetches each prepared input and logs progress', async () => {
    const section = {
      name: 'intro',
      type: 'video',
      options: { videoUrl: 'http://a/v.mp4' },
    } as unknown as Section;
    const { manager, fs, logger } = build({ section });
    await manager.fetchAssets();
    expect(fs.fetch).toHaveBeenCalledWith('http://a/v.mp4');
    expect(fs.move).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[intro][Assets]'));
  });

  it('logs and rethrows when an asset fetch fails', async () => {
    const fs = createFilesystem();
    fs.fetch.mockRejectedValueOnce(new Error('network down'));
    const section = {
      name: 'intro',
      type: 'video',
      options: { videoUrl: 'http://a/v.mp4' },
    } as unknown as Section;
    const { manager, logger } = build({ section, fs });
    await expect(manager.fetchAssets()).rejects.toThrow('network down');
    expect(logger.error).toHaveBeenCalledWith('network down');
  });

  it('stringifies non-Error rejections before logging', async () => {
    const fs = createFilesystem();
    fs.fetch.mockRejectedValueOnce('boom');
    const section = {
      name: 'intro',
      type: 'video',
      options: { videoUrl: 'http://a/v.mp4' },
    } as unknown as Section;
    const { manager, logger } = build({ section, fs });
    await expect(manager.fetchAssets()).rejects.toBe('boom');
    expect(logger.error).toHaveBeenCalledWith('boom');
  });

  it('resolves a missing url from the input name via variables', async () => {
    const section = {
      name: 'intro',
      type: 'video',
      inputs: [{ name: 'clip' }],
    } as unknown as Section;
    const { manager, variableManager } = build({
      section,
      mapVariables: (v: string) => v.replace('{{ clip }}', 'http://a/clip.mp4'),
    });
    await manager.fetchAssets();
    expect(variableManager.mapVariables).toHaveBeenCalledWith('{{ clip }}');
  });

  it('accepts a relative assets path (resolved offline-first, else fetched)', async () => {
    const section = {
      name: 'intro',
      type: 'video',
      inputs: [{ name: 'clip', url: 'videos/clip.mp4' }],
    } as unknown as Section;
    const { manager, fs } = build({ section });
    await manager.fetchAssets();
    // No local copy in the mock → falls back to fetch with the relative path preserved.
    expect(fs.fetch).toHaveBeenCalledWith('videos/clip.mp4');
  });

  it('throws when a url is an unresolved {{ variable }}', async () => {
    const section = {
      name: 'intro',
      type: 'video',
      inputs: [{ name: 'clip', url: '{{ missing }}' }],
    } as unknown as Section;
    const { manager } = build({ section });
    await expect(manager.fetchAssets()).rejects.toThrow(/is not valid/);
  });

  it('accepts absolute local paths', async () => {
    const section = {
      name: 'intro',
      type: 'video',
      inputs: [{ name: 'clip', url: '/local/clip.mp4' }],
    } as unknown as Section;
    const { manager, fs } = build({ section });
    await manager.fetchAssets();
    expect(fs.fetch).toHaveBeenCalledWith('/local/clip.mp4');
  });

  it('skips fetching when the input name is already cached', async () => {
    const section = {
      name: 'intro',
      type: 'video',
      inputs: [{ name: 'clip', url: 'http://a/clip.mp4' }],
    } as unknown as Section;
    const { manager, fs } = build({ section, inputsCache: { clip: '/cached.mp4' } });
    await manager.fetchAssets();
    expect(fs.fetch).not.toHaveBeenCalled();
  });

  it('fetches a single-file animation input as one media', async () => {
    const section = {
      name: 'intro',
      type: 'video',
      inputs: [
        {
          name: 'spark',
          url: 'http://a/spark.apng',
          type: 'animation',
          options: {},
        },
      ],
    } as unknown as Section;
    const { manager, fs } = build({ section });
    await manager.fetchAssets();
    expect(fs.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('AssetManager.fetchFonts', () => {
  it('skips a font that already exists on disk', async () => {
    const fs = createFilesystem();
    fs.stat.mockResolvedValue(true);
    const { manager, logger } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'Roboto-Bold.ttf' }];
    await manager.fetchFonts();
    expect(fs.fetchAndRead).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('cached'));
  });

  it('copies a bundled font instead of downloading when one ships with the package', async () => {
    const fs = createFilesystem();
    fs.resolveBundledFont.mockResolvedValue('/pkg/dist/fonts/BebasNeue.ttf');
    const { manager, logger } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'BebasNeue.ttf' }];
    await manager.fetchFonts();
    expect(fs.copy).toHaveBeenCalledWith('/pkg/dist/fonts/BebasNeue.ttf', '/fonts/BebasNeue.ttf');
    expect(fs.fetchAndRead).not.toHaveBeenCalled();
    expect(fs.fetch).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('bundled'));
  });

  it('downloads a font referenced in the Google Fonts CSS', async () => {
    const fs = createFilesystem();
    fs.fetchAndRead.mockResolvedValue('src: url(https://fonts.gstatic.com/s/roboto/v1/font.ttf) format("truetype");');
    fs.fetch.mockResolvedValue('/tmp/font.ttf');
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'Roboto-Bold.ttf' }];
    await manager.fetchFonts();
    expect(fs.fetch).toHaveBeenCalledWith('https://fonts.gstatic.com/s/roboto/v1/font.ttf');
    expect(fs.move).toHaveBeenCalledWith('/tmp/font.ttf', '/fonts/Roboto-Bold.ttf');
  });

  // The face behind a legacy filename is a guess from its stem (`Roboto-Bold.ttf` fetches Roboto
  // 400): persisting it under that name would outlive any fix to the guess.
  it('does not persist a face guessed from a legacy filename', async () => {
    const fs = createFilesystem();
    fs.fetchAndRead.mockResolvedValue('src: url(https://fonts.gstatic.com/s/roboto/v1/font.ttf) format("truetype");');
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'Roboto-Bold.ttf' }];
    await manager.fetchFonts();
    expect(fs.cacheFont).not.toHaveBeenCalled();
  });

  // A catalog font is a download too: seeding the persistent cache is what lets a fresh build dir
  // (every MCP render) stage it without fetching it again.
  it('seeds the persistent cache after downloading a catalog font', async () => {
    const fs = createFilesystem();
    fs.fetch.mockResolvedValue('/tmp/Oswald.ttf');
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'Oswald.ttf' }];
    await manager.fetchFonts();
    expect(fs.move).toHaveBeenCalledWith('/tmp/Oswald.ttf', '/fonts/Oswald.ttf');
    expect(fs.cacheFont).toHaveBeenCalledWith('Oswald.ttf', '/fonts/Oswald.ttf');
    expect(fs.fetchAndRead).not.toHaveBeenCalled();
  });

  // Previously this logged "no font url found" and returned, leaving the segment to render with no
  // font at all — a silently wrong video. A font that cannot be staged is now a hard failure.
  it('throws when the CSS carries no gstatic font url', async () => {
    const fs = createFilesystem();
    fs.fetchAndRead.mockResolvedValue('/* no font here */');
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'Mystery.ttf' }];
    await expect(manager.fetchFonts()).rejects.toThrow(/Mystery\.ttf/);
    expect(fs.fetch).not.toHaveBeenCalled();
  });
});

// A FontRef names a family directly instead of leaning on a filename, so the exact weight/style is
// requested rather than guessed from the file stem.
describe('AssetManager.fetchFonts with a FontRef', () => {
  const ttfCss = "src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3Fwr.ttf) format('truetype');";

  it('requests the family and weight named by the ref, not the filename', async () => {
    const fs = createFilesystem();
    fs.fetchAndRead.mockResolvedValue(ttfCss);
    fs.fetch.mockResolvedValue('/tmp/inter.ttf');
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'google-inter-700.ttf', ref: { family: 'Inter', weight: 700 } }];
    await manager.fetchFonts();
    expect(fs.fetchAndRead).toHaveBeenCalledWith(
      'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,700',
      expect.objectContaining({ 'User-Agent': expect.any(String) })
    );
    expect(fs.move).toHaveBeenCalledWith('/tmp/inter.ttf', '/fonts/google-inter-700.ttf');
  });

  it('resolves a multi-word family the old filename-derived lookup could not', async () => {
    const fs = createFilesystem();
    fs.fetchAndRead.mockResolvedValue(ttfCss);
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'google-playfair-display-400.ttf', ref: { family: 'Playfair Display' } }];
    await manager.fetchFonts();
    expect(fs.fetchAndRead).toHaveBeenCalledWith(
      'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400',
      expect.anything()
    );
  });

  it('reuses a font already in the persistent cache instead of downloading', async () => {
    const fs = createFilesystem();
    fs.resolveCachedFont.mockResolvedValue('/cache/google-inter-400.ttf');
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'google-inter-400.ttf', ref: { family: 'Inter' } }];
    await manager.fetchFonts();
    expect(fs.copy).toHaveBeenCalledWith('/cache/google-inter-400.ttf', '/fonts/google-inter-400.ttf');
    expect(fs.fetchAndRead).not.toHaveBeenCalled();
  });

  it('populates the persistent cache after a download so the next render works offline', async () => {
    const fs = createFilesystem();
    fs.fetchAndRead.mockResolvedValue(ttfCss);
    fs.fetch.mockResolvedValue('/tmp/inter.ttf');
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'google-inter-400.ttf', ref: { family: 'Inter' } }];
    await manager.fetchFonts();
    expect(fs.cacheFont).toHaveBeenCalledWith('google-inter-400.ttf', '/fonts/google-inter-400.ttf');
  });

  // A browser cannot override User-Agent, so Google returns woff2, which drawtext cannot read.
  // Failing up front beats emitting a video with the wrong typeface.
  it('throws on a platform that cannot fetch a truetype face', async () => {
    const fs = createFilesystem();
    fs.supportsRemoteFonts = false;
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'google-inter-400.ttf', ref: { family: 'Inter' } }];
    await expect(manager.fetchFonts()).rejects.toThrow(/Inter/);
    expect(fs.fetchAndRead).not.toHaveBeenCalled();
  });

  // The Expo adapter used to resolve an HTTP error with its body: the CSS then carries no font url.
  it('names the family in the error when the css carries no truetype face', async () => {
    const fs = createFilesystem();
    fs.fetchAndRead.mockResolvedValue('/* 400 */');
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'google-intr-400.ttf', ref: { family: 'Intr' } }];
    await expect(manager.fetchFonts()).rejects.toThrow(/Intr/);
  });

  // Google answers an unknown family, a weight the family lacks or italic on an upright-only family
  // with HTTP 400, which the Node adapter surfaces as a bare rejection that names no font.
  it('names the face when google rejects the css request', async () => {
    const fs = createFilesystem();
    fs.fetchAndRead.mockRejectedValue(new Error('Request failed with status code 400'));
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [
      { file: 'google-bebas-neue-400-italic.ttf', ref: { family: 'Bebas Neue', style: 'italic' } },
    ];
    await expect(manager.fetchFonts()).rejects.toThrow(/"Bebas Neue" weight 400 italic.*status code 400/);
    expect(fs.fetch).not.toHaveBeenCalled();
  });

  // Legacy filenames spell a multi-word family with `+` (Google's own URL convention); the family
  // must reach css2 as spaces, not as a literal `+` once the family is percent-encoded.
  it('reads a legacy filename that spells spaces as + as a multi-word family', async () => {
    const fs = createFilesystem();
    fs.fetchAndRead.mockResolvedValue(ttfCss);
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'Rubik+Doodle+Shadow.ttf' }];
    await manager.fetchFonts();
    expect(fs.fetchAndRead).toHaveBeenCalledWith(
      'https://fonts.googleapis.com/css2?family=Rubik+Doodle+Shadow:ital,wght@0,400',
      expect.anything()
    );
  });

  // Reading the cache is best-effort like writing it: an entry that can't be read (a shared cache
  // written by another user) falls through to the download instead of failing the section.
  it('downloads when the cached face cannot be read', async () => {
    const fs = createFilesystem();
    fs.resolveCachedFont.mockResolvedValue('/cache/google-inter-400.ttf');
    fs.copy.mockRejectedValue(new Error('EACCES: permission denied'));
    fs.fetchAndRead.mockResolvedValue(ttfCss);
    fs.fetch.mockResolvedValue('/tmp/inter.ttf');
    const { manager } = build({ section: { name: 's', type: 'video' }, fs });
    manager.segment.tempFonts = [{ file: 'google-inter-400.ttf', ref: { family: 'Inter' } }];
    await manager.fetchFonts();
    expect(fs.move).toHaveBeenCalledWith('/tmp/inter.ttf', '/fonts/google-inter-400.ttf');
  });
});

describe('AssetManager.fetchMedia', () => {
  it('fetches, moves and caches a media by its url', async () => {
    const fs = createFilesystem();
    fs.fetch.mockResolvedValue('/tmp/video');
    const cache: Record<string, string | string[]> = {};
    const { manager } = build({ section: { name: 's', type: 'video' }, inputsCache: cache, fs });
    await manager.fetchMedia({ name: 'clip', url: 'http://a/clip.mp4' } as Media);
    expect(fs.move).toHaveBeenCalledWith('/tmp/video', expect.stringMatching(/^\/assets\/clip-\w+\.mp4$/));
    expect(cache['http://a/clip.mp4']).toMatch(/^\/assets\/clip-\w+\.mp4$/);
  });

  it('stages two same-named media from different urls to different files', async () => {
    // A section background is staged under the section's name, so an input named after the section
    // used to be downloaded onto the very same file and overwrite it.
    const cache: Record<string, string | string[]> = {};
    const { manager } = build({ section: { name: 'badge', type: 'image_background' }, inputsCache: cache });
    await manager.fetchMedia({ name: 'badge', url: 'http://a/bg.png' } as Media);
    await manager.fetchMedia({ name: 'badge', url: 'http://a/logo.png' } as Media);
    expect(cache['http://a/bg.png']).not.toBe(cache['http://a/logo.png']);
  });

  it('uses a staged local asset and skips the download', async () => {
    const fs = createFilesystem();
    fs.resolveLocalAsset.mockResolvedValue('/assets/pictures/logo.png');
    const cache: Record<string, string | string[]> = {};
    const { manager } = build({ section: { name: 's', type: 'video' }, inputsCache: cache, fs });
    await manager.fetchMedia({ name: 'watermark', url: 'http://a/logo.png' } as Media);
    expect(fs.fetch).not.toHaveBeenCalled();
    expect(fs.move).not.toHaveBeenCalled();
    expect(cache['http://a/logo.png']).toBe('/assets/pictures/logo.png');
  });

  it('does not re-fetch an already cached media url', async () => {
    const fs = createFilesystem();
    const { manager } = build({
      section: { name: 's', type: 'video' },
      inputsCache: { 'http://a/clip.mp4': '/assets/clip.mp4' },
      fs,
    });
    await manager.fetchMedia({ name: 'clip', url: 'http://a/clip.mp4' } as Media);
    expect(fs.fetch).not.toHaveBeenCalled();
  });
});

describe('AssetManager.fetchCachedMedia', () => {
  it('returns the cached path keyed by url', () => {
    const { manager } = build({
      section: { name: 's', type: 'video' },
      inputsCache: { 'http://a/clip.mp4': '/assets/clip.mp4' },
    });
    expect(manager.fetchCachedMedia({ name: 'clip', url: 'http://a/clip.mp4' } as Media)).toBe('/assets/clip.mp4');
  });

  it('falls back to the name key when url is not cached', () => {
    const { manager } = build({
      section: { name: 's', type: 'video' },
      inputsCache: { clip: '/assets/by-name.mp4' },
    });
    expect(manager.fetchCachedMedia({ name: 'clip', url: 'http://uncached/clip.mp4' } as Media)).toBe(
      '/assets/by-name.mp4'
    );
  });

  it('throws when neither url nor name is cached', () => {
    const { manager } = build({ section: { name: 's', type: 'video' } });
    expect(() => manager.fetchCachedMedia({ name: 'clip', url: 'http://a/clip.mp4' } as Media)).toThrow(
      /No cache found/
    );
  });
});

describe('AssetManager panel: scheme', () => {
  it('generates and stages a rounded-panel PNG instead of fetching', async () => {
    const fs = createFilesystem();
    fs.stat.mockResolvedValue(false); // not yet staged
    const cache: Record<string, string | string[]> = {};
    const { manager } = build({ section: { name: 's', type: 'video' }, inputsCache: cache, fs });

    await manager.fetchMedia({ name: 'panel', url: 'panel:w=380,h=150,r=28,c=0a0f14,o=0.72' } as Media);

    // Wrote a PNG (starts with the 8-byte signature) to the panels dir, keyed by the deterministic name.
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [path, bytes] = fs.writeFile.mock.calls[0];
    expect(path).toBe('/panels/panel-380x150-r28-0a0f14-o72.png');
    expect(Array.from((bytes as Uint8Array).slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // Did NOT hit the network / local-resolve fetch path.
    expect(fs.fetch).not.toHaveBeenCalled();
    // Cache now resolves the input to the staged file.
    expect(manager.fetchCachedMedia({ name: 'panel', url: 'panel:w=380,h=150,r=28,c=0a0f14,o=0.72' } as Media)).toBe(
      '/panels/panel-380x150-r28-0a0f14-o72.png'
    );
  });

  it('reuses an already-staged panel without rewriting', async () => {
    const fs = createFilesystem();
    fs.stat.mockResolvedValue(true); // already staged
    const cache: Record<string, string | string[]> = {};
    const { manager } = build({ section: { name: 's', type: 'video' }, inputsCache: cache, fs });

    await manager.fetchMedia({ name: 'panel', url: 'panel:w=380,h=150,r=28,c=0a0f14,o=0.72' } as Media);

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.fetch).not.toHaveBeenCalled();
  });
});

describe('AssetManager.extractFromMedia', () => {
  it('extracts name, mapped url and extension from a plain media', () => {
    const { manager } = build({ section: { name: 's', type: 'video' } });
    const result = manager.extractFromMedia({ name: 'clip', url: 'http://a/clip.mp4' } as Media);
    expect(result).toEqual({ name: 'clip', url: 'http://a/clip.mp4', extension: 'mp4' });
  });

  it('derives the name from the url when media has no name', () => {
    const { manager } = build({ section: { name: 's', type: 'video' } });
    const result = manager.extractFromMedia({ url: 'http://a/path/song.title.mp3' } as Media);
    // last path segment minus extension -> "song.title"
    expect(result.name).toBe('song.title');
    expect(result.extension).toBe('mp3');
  });

  it('handles an empty media url', () => {
    const { manager } = build({ section: { name: 's', type: 'video' } });
    const result = manager.extractFromMedia({ name: 'x' } as Media);
    expect(result.url).toBe('');
  });

  it('replaces the %d frame token in url with the raw frame number', () => {
    const { manager } = build({ section: { name: 's', type: 'video' } });
    // url contains %d but does not already end in -NNN.ext, so the raw frame is used
    const result = manager.extractFromMedia({ url: 'http://a/frame-%d.png' } as Media, 4);
    expect(result.url).toBe('http://a/frame-4.png');
  });

  it('replaces %d with the raw frame number when url lacks the 3-digit pattern', () => {
    const { manager } = build({ section: { name: 's', type: 'video' } });
    const result = manager.extractFromMedia({ url: 'http://a/frame%d.gif' } as Media, 7);
    expect(result.url).toBe('http://a/frame7.gif');
  });

  it('leaves url untouched for a positive frame when no %d token present', () => {
    const { manager } = build({ section: { name: 's', type: 'video' } });
    const result = manager.extractFromMedia({ url: 'http://a/frame.png' } as Media, 2);
    expect(result.url).toBe('http://a/frame.png');
  });

  it('replaces %d in the generated name when frame is set', () => {
    const { manager } = build({ section: { name: 's', type: 'video' } });
    const result = manager.extractFromMedia({ url: 'http://a/frame-%d.png' } as Media, 9);
    // name derived from url segment then %d -> 009; url already substituted so name keeps literal
    expect(result.name).toContain('frame-');
  });
});
