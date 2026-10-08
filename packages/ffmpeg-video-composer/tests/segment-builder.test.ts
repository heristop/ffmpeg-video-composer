import 'reflect-metadata';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import SegmentBuilder from '@/editor/SegmentBuilder';
import { SectionError } from '@/core/errors/section-error';
import type { ProjectConfig, Section, TemplateDescriptor } from '@/core/types';
import { isBackgroundInput, markBackgroundInput } from '@/editor/utils/background-input';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeSegment() {
  return {
    currentSection: undefined as Section | undefined,
    filtersList: [] as string[],
    filtersMapList: [] as string[],
    mapsList: [] as string[],
    tempFonts: [] as string[],
    inputsAsset: [] as unknown,
    inputsMapCount: 0,
  };
}

function makeManagers(logger = makeLogger(), filesystem = makeFilesystem()) {
  return {
    assetManager: {
      segment: undefined,
      setUpPaths: vi.fn(async () => undefined),
      fetchAssets: vi.fn(async () => undefined),
      fetchFonts: vi.fn(async () => undefined),
      fetchLuts: vi.fn(async () => undefined),
      fetchCachedMedia: vi.fn((media: { name: string }, frame = 0) => `/cache/${media.name}_${frame}.png`),
      isBackgroundInput,
    },
    variableManager: {},
    mapManager: {
      segment: undefined,
      addMap: vi.fn(),
      addAnimationOverlay: vi.fn(),
      addGradientOverlay: vi.fn(),
      getVideoInputIncrement: vi.fn(() => 1),
    },
    filterManager: {
      segment: undefined,
      addFilter: vi.fn((f: { type: string; value?: string | number }) => `${f.type}=${String(f.value ?? '')}`),
    },
    formattersManager: {
      segment: undefined,
      formatColor: vi.fn((c: string) => `#${c}`),
    },
    logger,
    filesystemAdapter: filesystem,
  };
}

function makeFilesystem() {
  return {
    getSource: vi.fn(() => '/source/in.mp4'),
    getDestination: vi.fn(() => '/build/out.mp4'),
    setSegment: vi.fn(),
  };
}

function makeProject(config: ProjectConfig = {}, durations: Record<string, number> = {}) {
  // buildInfos.durations holds the ffprobe-probed clip lengths the director fills before segments
  // build; injectSugarFilters reads it to calibrate Ken Burns on video sections.
  return { config, buildInfos: { durations } };
}

function makeTemplate(descriptor: TemplateDescriptor = {}, inputs: unknown = []) {
  return { descriptor, assets: { fonts: {}, musics: {}, inputs } };
}

function makeBuilder(
  opts: {
    project?: ReturnType<typeof makeProject>;
    template?: ReturnType<typeof makeTemplate>;
    segment?: ReturnType<typeof makeSegment>;
    managers?: ReturnType<typeof makeManagers>;
  } = {}
) {
  const project = opts.project ?? makeProject({ videoConfig: { scale: '1280:720', setsar: '1/1' } });
  const template = opts.template ?? makeTemplate();
  const segment = opts.segment ?? makeSegment();
  const managers = opts.managers ?? makeManagers();

  const builder = new SegmentBuilder(project as never, template as never, segment as never, managers as never);

  return { builder, project, template, segment, managers };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SegmentBuilder constructor', () => {
  // Output orientation is resolved ONCE in TemplateDirector.config, not per segment — a per-segment
  // swap re-applied on the shared project config and alternated portrait/landscape across segments.
  it('does not swap the scale for a portrait template (handled by the director)', () => {
    const project = makeProject({ videoConfig: { scale: '1280:720' } });
    const template = makeTemplate({ global: { orientation: 'portrait' } });

    makeBuilder({ project, template });

    expect(project.config.videoConfig?.scale).toBe('1280:720');
  });
});

describe('SegmentBuilder.hydrate', () => {
  it('resets segment state and wires managers to the segment', () => {
    const segment = makeSegment();
    const { builder, managers } = makeBuilder({ segment });
    const section: Section = { name: 'clip', type: 'video' };

    const returned = builder.hydrate(section);

    expect(returned).toBe(builder);
    expect(segment.currentSection).toBe(section);
    expect(section.inputs).toEqual([]);
    expect(managers.assetManager.segment).toBe(segment);
    expect(managers.mapManager.segment).toBe(segment);
    expect(managers.filterManager.segment).toBe(segment);
    expect(managers.formattersManager.segment).toBe(segment);
    expect(managers.filesystemAdapter.setSegment).toHaveBeenCalledWith('clip');
  });
});

describe('SegmentBuilder.init', () => {
  it('builds the segment successfully and returns true', async () => {
    const { builder, managers } = makeBuilder();
    builder.hydrate({ name: 'clip', type: 'video', options: {} });

    const result = await builder.init();

    expect(result).toBe(true);
    expect(managers.assetManager.setUpPaths).toHaveBeenCalled();
    expect(managers.assetManager.fetchAssets).toHaveBeenCalled();
    expect(managers.assetManager.fetchFonts).toHaveBeenCalled();
  });

  // A swallowed build error left the command at `-version`, so the section rendered nothing and the
  // compile still "succeeded" with that section missing. The failure must reach the director.
  it('rejects with a SectionError naming the section and the cause when building throws', async () => {
    const managers = makeManagers();
    const cause = new Error('asset boom');
    managers.assetManager.fetchAssets.mockRejectedValue(cause);
    const { builder } = makeBuilder({ managers });
    builder.hydrate({ name: 'clip', type: 'video', options: {} });

    const failure = await builder.init().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SectionError);
    expect(failure).toMatchObject({ section: 'clip', cause, message: 'Section "clip" failed: asset boom' });
    expect(managers.logger.error).toHaveBeenCalledWith('Section "clip" failed: asset boom');
  });

  it('rejects when a font cannot be resolved', async () => {
    const managers = makeManagers();
    managers.assetManager.fetchFonts.mockRejectedValue(new Error('No cache found for keys Nope.ttf'));
    const { builder } = makeBuilder({ managers });
    builder.hydrate({ name: 'title', type: 'color_background', options: { duration: 1 } });

    await expect(builder.init()).rejects.toThrow('Section "title" failed: No cache found for keys Nope.ttf');
  });

  it('normalizes a background color through the formatter before building', async () => {
    const managers = makeManagers();
    const { builder } = makeBuilder({ managers });
    const section: Section = {
      name: 'bg',
      type: 'color_background',
      options: { backgroundColor: 'ff0000', duration: 2 },
    };
    builder.hydrate(section);

    await builder.init();

    expect(managers.formattersManager.formatColor).toHaveBeenCalledWith('ff0000');
    expect(section.options?.backgroundColor).toBe('#ff0000');
  });

  it('applies the hwaccel argument when configured', async () => {
    const project = makeProject({
      videoConfig: { scale: '1280:720' },
      hardwareConfig: { hwaccel: 'cuda' },
    });
    const { builder } = makeBuilder({ project });
    builder.hydrate({ name: 'clip', type: 'video', options: {} });

    // configure() is a no-op on the base class, so just ensure init succeeds with hwaccel set
    const result = await builder.init();
    expect(result).toBe(true);
  });
});

describe('SegmentBuilder.buildMaps', () => {
  it('processes a single media input into an asset entry', async () => {
    const segment = makeSegment();
    const { builder, managers } = makeBuilder({ segment });
    builder.hydrate({ name: 'clip', type: 'video' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'video',
      inputs: [{ name: 'logo', url: 'http://x/logo.png' }],
    } as never;

    await builder.buildMaps();

    const assets = segment.inputsAsset as unknown as Record<string, string>;
    expect(assets.asset_logo).toBe('/cache/logo_0.png');
    expect(managers.assetManager.fetchCachedMedia).toHaveBeenCalled();
  });

  it('registers a .webm single-file animation with -c:v libvpx-vp9 before its -i', async () => {
    const segment = makeSegment();
    const { builder, managers } = makeBuilder({ segment });
    builder.hydrate({ name: 'clip', type: 'video' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'video',
      inputs: [{ name: 'anim', url: 'http://x/anim.webm', type: 'animation', options: {} }],
    } as never;

    await builder.buildMaps();

    const assets = segment.inputsAsset as unknown as Record<string, string>;
    expect(assets.asset_anim).toContain('-c:v libvpx-vp9');
    expect(assets.asset_anim).toContain('-i /cache/anim_0.png');
    expect(managers.mapManager.addAnimationOverlay).toHaveBeenCalledTimes(1);
  });

  it('registers a type:image input held with -loop 1 and composited as an overlay', async () => {
    const segment = makeSegment();
    const { builder, managers } = makeBuilder({ segment });
    builder.hydrate({ name: 'clip', type: 'video' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'video',
      inputs: [
        { name: 'logo', url: 'pictures/logo.png', type: 'image', options: { position: '40:40', scale: '120:-1' } },
      ],
    } as never;

    await builder.buildMaps();

    const assets = segment.inputsAsset as unknown as Record<string, string>;
    expect(assets.asset_logo).toContain('-loop 1 -i /cache/logo_0.png');
    expect(managers.mapManager.addAnimationOverlay).toHaveBeenCalledTimes(1);
    expect(managers.mapManager.addAnimationOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'logo', type: 'image' }),
      expect.any(Number),
      '1280:720'
    );
  });

  it('numbers animation overlays after a base media input (image_background picture)', async () => {
    // image_background's pictureUrl is injected as the first input (named after the section); it is the
    // base video leg at getVideoInputIncrement(), not an overlay. An animation that follows must be the
    // NEXT input index, not shifted one past the base — otherwise its overlay references a missing stream.
    const segment = makeSegment();
    const { builder, managers } = makeBuilder({ segment });
    builder.hydrate({ name: 'hero', type: 'image_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'hero',
      type: 'image_background',
      inputs: [
        markBackgroundInput({ name: 'hero', url: 'pictures/bg.png' }),
        { name: 'shine', url: 'shine.apng', type: 'animation', options: {} },
      ],
    } as never;

    await builder.buildMaps();

    // base picture is input 1 (getVideoInputIncrement); the animation is the next input → index 2.
    expect(managers.mapManager.addAnimationOverlay).toHaveBeenCalledTimes(1);
    expect(managers.mapManager.addAnimationOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'shine' }),
      2,
      '1280:720'
    );
  });

  it('numbers an input named after a color section past the color source', async () => {
    // Only the injected background occupies the base slot. An authored input that merely shares the
    // section's name is an overlay: numbering it as the base made it overlay the color onto itself.
    const segment = makeSegment();
    const { builder, managers } = makeBuilder({ segment });
    builder.hydrate({ name: 'badge', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'badge',
      type: 'color_background',
      options: { backgroundColor: '#000', duration: 1 },
      inputs: [{ name: 'badge', url: 'pictures/logo.png', type: 'image', options: {} }],
    } as never;

    await builder.buildMaps();

    expect(managers.mapManager.addAnimationOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'badge' }),
      2,
      '1280:720'
    );
  });

  it('keeps both the background and an input named after the section as inputs', async () => {
    const segment = makeSegment();
    const { builder, managers } = makeBuilder({ segment });
    builder.hydrate({ name: 'badge', type: 'image_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'badge',
      type: 'image_background',
      inputs: [
        markBackgroundInput({ name: 'badge', url: 'pictures/bg.png' }),
        { name: 'badge', url: 'pictures/logo.png', type: 'image', options: {} },
      ],
    } as never;

    await builder.buildMaps();

    expect(Object.keys(segment.inputsAsset as unknown as Record<string, string>)).toHaveLength(2);
    expect(managers.mapManager.addAnimationOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'badge', type: 'image' }),
      2,
      '1280:720'
    );
  });

  it('composites gradient layers under animation overlays (animation is the final map)', async () => {
    const segment = makeSegment();
    const { builder, managers } = makeBuilder({ segment });
    builder.hydrate({ name: 'bg', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'bg',
      type: 'color_background',
      options: {
        backgroundColor: '#000',
        duration: 2,
        layers: [{ gradient: { from: '#f06', to: '#0cf', direction: 'diagonal' }, opacity: 1 }],
      },
      inputs: [{ name: 'shine', url: 'shine.apng', type: 'animation', options: {} }],
    } as never;

    await builder.buildMaps();

    expect(managers.mapManager.addGradientOverlay).toHaveBeenCalledTimes(1);
    expect(managers.mapManager.addAnimationOverlay).toHaveBeenCalledTimes(1);
    // The gradient is the background: it must composite BEFORE the animation overlay so the animation
    // is the final mapped pad. Built the other way round, the gradient pad wins and overlays vanish.
    const gradientOrder = managers.mapManager.addGradientOverlay.mock.invocationCallOrder[0];
    const animationOrder = managers.mapManager.addAnimationOverlay.mock.invocationCallOrder[0];
    expect(gradientOrder).toBeLessThan(animationOrder);
  });

  it('treats a non-animation .png input as plain cached media (no overlay map)', async () => {
    const segment = makeSegment();
    const { builder, managers } = makeBuilder({ segment });
    builder.hydrate({ name: 'clip', type: 'video' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'video',
      inputs: [{ name: 'logo', url: 'http://x/logo.png' }],
    } as never;

    await builder.buildMaps();

    const assets = segment.inputsAsset as unknown as Record<string, string>;
    expect(assets.asset_logo).toBe('/cache/logo_0.png');
    expect(managers.mapManager.addAnimationOverlay).not.toHaveBeenCalled();
  });

  it('registers a gradient layer as a gradients lavfi input + overlay map', async () => {
    const segment = makeSegment();
    const project = makeProject({ videoConfig: { scale: '1280:720' } });
    const { builder, managers } = makeBuilder({ segment, project });
    builder.hydrate({ name: 'bg', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'bg',
      type: 'color_background',
      options: {
        duration: 4,
        layers: [{ gradient: { from: '#000000', to: '#ffffff', direction: 'vertical' }, opacity: 0.5 }],
      },
    } as never;

    await builder.buildMaps();

    const assets = segment.inputsAsset as unknown as Record<string, string>;
    expect(assets.gradient_0).toContain('gradients=s=1280x720:c0=#000000:c1=#ffffff:d=4');
    expect(managers.mapManager.addGradientOverlay).toHaveBeenCalledTimes(1);
  });

  it('sizes a gradient layer to its w/h box and overlays it at the resolved x/y', async () => {
    const segment = makeSegment();
    const project = makeProject({ videoConfig: { scale: '1280:720' } });
    const { builder, managers } = makeBuilder({ segment, project });
    builder.hydrate({ name: 'bg', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'bg',
      type: 'color_background',
      options: {
        duration: 4,
        layers: [
          {
            gradient: { from: '#000000', to: '#ffffff', direction: 'vertical' },
            x: 'iw*0.25',
            y: 'ih*0.25',
            w: 'iw*0.5',
            h: 'ih*0.5',
          },
        ],
      },
    } as never;

    await builder.buildMaps();

    // The gradients source is the layer box, not the full frame, and the overlay lands at the
    // resolved pixel offset (overlay expressions have no iw/ih, so raw layer values would break).
    const assets = segment.inputsAsset as unknown as Record<string, string>;
    expect(assets.gradient_0).toContain('gradients=s=640x360');
    expect(managers.mapManager.addGradientOverlay).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      'gradient_layer_0',
      '320:180'
    );
  });

  it('skips solid (non-gradient) layers in the inputs/maps pipeline', async () => {
    const segment = makeSegment();
    const { builder, managers } = makeBuilder({ segment });
    builder.hydrate({ name: 'bg', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'bg',
      type: 'color_background',
      options: { duration: 2, layers: [{ color: '#112233', opacity: 0.5 }] },
    } as never;

    await builder.buildMaps();

    const assets = segment.inputsAsset as unknown as Record<string, string>;
    expect(Object.keys(assets)).toHaveLength(0);
    expect(managers.mapManager.addGradientOverlay).not.toHaveBeenCalled();
  });
});

describe('SegmentBuilder.buildFilters / formatFilters', () => {
  it('prepends setsar/scale filters and formats them into a filter_complex', async () => {
    const segment = makeSegment();
    const { builder } = makeBuilder({ segment });
    builder.hydrate({ name: 'clip', type: 'video' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'video',
      options: {},
      filters: [{ type: 'eq', value: 'contrast=1.2' }],
      maps: [],
    } as never;

    await builder.buildFilters();

    expect(segment.filtersList.length).toBeGreaterThan(0);
    // forceAspectRatio (the default) COVERS the frame: scale up to fill, then crop the overflow — so a
    // mismatched source (e.g. a portrait clip in a square template) fills the frame without stretching.
    expect(segment.filtersList).toEqual(
      expect.arrayContaining(['scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720', 'setsar=1/1'])
    );
  });

  it('skips scale filters when forceAspectRatio is false and there is no forceOriginalAspectRatio', async () => {
    const segment = makeSegment();
    const { builder } = makeBuilder({ segment });
    builder.hydrate({ name: 'clip', type: 'video' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'video',
      options: { forceAspectRatio: false },
      filters: [],
      maps: [],
    } as never;

    await builder.buildFilters();

    // no scale/setsar prepended
    expect(segment.filtersList).not.toEqual(expect.arrayContaining(['scale=1280:720']));
  });

  it('builds a padded scale filter when forceOriginalAspectRatio is set', async () => {
    const segment = makeSegment();
    const managers = makeManagers();
    const { builder } = makeBuilder({ segment, managers });
    builder.hydrate({ name: 'clip', type: 'video' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'video',
      options: { forceOriginalAspectRatio: true },
      filters: [],
      maps: [],
    } as never;

    await builder.buildFilters();

    const scaleFilterCall = managers.filterManager.addFilter.mock.calls.find(
      (c) => (c[0] as { type: string }).type === 'scale'
    );
    const scaleFilterArg = scaleFilterCall?.[0] as { value: string };

    expect(scaleFilterArg.value).toContain('force_original_aspect_ratio=decrease');
  });

  it('uses an empty base scale when videoConfig.scale is undefined (line 293 nullish side)', () => {
    const segment = makeSegment();
    // videoConfig present but WITHOUT a scale -> `videoConfig?.scale ?? ''` takes '' side
    const project = makeProject({ videoConfig: { setsar: '1/1' } });
    const { builder } = makeBuilder({ segment, project });
    const section: Section = {
      name: 'clip',
      type: 'video',
      options: { forceOriginalAspectRatio: true },
      filters: [],
      maps: [],
    };
    (builder as unknown as { section: Section }).section = section;

    // Invoke the private scale-prepending helper directly with options set.
    (builder as unknown as { prependScaleFilters: (o: unknown) => void }).prependScaleFilters(section.options);

    const scaleFilter = section.filters?.find((f) => (f as { type: string }).type === 'scale') as {
      value: string;
    };
    // base scale resolved to '' so the padded expression starts from an empty base
    expect(scaleFilter.value).toContain(':force_original_aspect_ratio=decrease');
    expect(scaleFilter.value.startsWith(':force_original_aspect_ratio')).toBe(true);
  });

  it('defaults to an empty existing-filters list when section.filters is undefined (line 303 nullish side)', () => {
    const segment = makeSegment();
    const project = makeProject({ videoConfig: { scale: '1280:720', setsar: '1/1' } });
    const { builder } = makeBuilder({ segment, project });
    // section.filters is intentionally undefined -> `this.section.filters ?? []` nullish side
    const section = {
      name: 'clip',
      type: 'video',
      options: {},
    } as unknown as Section;
    (builder as unknown as { section: Section }).section = section;

    (builder as unknown as { prependScaleFilters: (o: unknown) => void }).prependScaleFilters(section.options);

    // setsar + scale prepended, with no pre-existing filters appended
    expect(section.filters).toHaveLength(2);
    const filters = section.filters as unknown as Array<{ type: string }>;
    expect(filters[0].type).toBe('setsar');
    expect(filters[1].type).toBe('scale');
  });

  it('adds maps and increments the input map count, joining with filtersMapList when present', async () => {
    const segment = makeSegment();
    const managers = makeManagers();
    // Simulate a map adding to filtersMapList and mapsList
    managers.mapManager.addMap.mockImplementation(() => {
      segment.filtersMapList.push('[0:v]overlay[outmap]');
      segment.mapsList.push('outmap');
    });
    const { builder } = makeBuilder({ segment, managers });
    builder.hydrate({ name: 'clip', type: 'video' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'video',
      options: {},
      filters: [{ type: 'eq', value: '1' }],
      maps: [{ inputs: ['0:v'], outputs: ['outmap'] }],
    } as never;

    await builder.buildFilters();

    expect(managers.mapManager.addMap).toHaveBeenCalled();
    expect(segment.inputsMapCount).toBe(1);
  });
});

describe('SegmentBuilder.buildInputs', () => {
  it('fills an asset-less color_background with its configured backgroundColor', () => {
    const segment = makeSegment();
    segment.inputsAsset = {} as unknown;
    const project = makeProject({ videoConfig: { scale: '1280:720' } });
    const { builder } = makeBuilder({ segment, project });
    builder.hydrate({ name: 'bg', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'bg',
      type: 'color_background',
      options: { backgroundColor: '#3366cc', duration: 3 },
    } as never;

    builder.buildInputs();

    // A solid color_background with no assets must use its color as the lavfi source — not a
    // transparent placeholder, which renders white.
    const sources = (builder as unknown as { sources: string[] }).sources;
    const colorSource = sources.find((source) => source.includes('color=c='));
    expect(colorSource).toContain('color=c=#3366cc');
    expect(colorSource).not.toContain('white@0.0');
  });

  it('uses the configured background color when assets are present and adds -i inputs', () => {
    const segment = makeSegment();
    segment.inputsAsset = { asset_logo: '/cache/logo.png' } as unknown;
    const { builder } = makeBuilder({ segment });
    builder.hydrate({ name: 'bg', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'bg',
      type: 'color_background',
      options: { backgroundColor: '#000', duration: 3 },
    } as never;

    expect(() => builder.buildInputs()).not.toThrow();
  });
});

describe('SegmentBuilder.addBlankAudio', () => {
  it('uses the configured channel layout and sample rate', () => {
    const project = makeProject({
      videoConfig: { scale: '1280:720' },
      audioConfig: { channelLayout: 'mono', sampleRate: 22050 },
    });
    const { builder } = makeBuilder({ project });

    const result = builder.addBlankAudio();

    expect(result).toContain('anullsrc=channel_layout=mono');
    expect(result).toContain('sample_rate=22050');
  });

  it('falls back to empty strings when audio config is missing', () => {
    const project = makeProject({ videoConfig: { scale: '1280:720' } });
    const { builder } = makeBuilder({ project });

    const result = builder.addBlankAudio();

    expect(result).toContain('anullsrc=channel_layout=');
  });
});

describe('SegmentBuilder.getCommand / getProject', () => {
  it('exposes the default command and the project instance', () => {
    const project = makeProject({ videoConfig: { scale: '1280:720' } });
    const { builder } = makeBuilder({ project });

    expect(builder.getCommand()).toBe('-version');
    expect(builder.getProject()).toBe(project);
  });
});

// ---------------------------------------------------------------------------
// Sugar injection: layers → motion → grade → look → authored filters
// ---------------------------------------------------------------------------

describe('SegmentBuilder structured-sugar injection', () => {
  it('injects layers → motion → grade → look → authored filters in order (no scale/sar when forceAspectRatio is false)', async () => {
    const segment = makeSegment();
    const managers = makeManagers();
    // The mock returns `${type}=${value ?? ''}` for every filter, which is enough to
    // distinguish each preset contribution by type prefix.
    const { builder } = makeBuilder({ segment, managers });
    builder.hydrate({ name: 'clip', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'color_background',
      options: {
        forceAspectRatio: false,
        duration: 5,
        layers: [{ color: '#112233', opacity: 0.5 }],
      },
      look: 'cinematic',
      grade: { saturation: 1.2 },
      motion: [{ type: 'kenburns' }],
      filters: [{ type: 'hflip' }],
      maps: [],
    } as never;

    await builder.buildFilters();

    const types = (segment.filtersList as string[]).map((s) => s.split('=')[0]);

    // drawbox from layersToFilters (color layer)
    const drawboxIdx = types.indexOf('drawbox');
    // scale + zoompan from motionToFilters(kenburns)
    const scaleIdx = types.indexOf('scale');
    const zoompanIdx = types.indexOf('zoompan');
    // eq from gradeToFilters (saturation)
    const eqGradeIdx = types.indexOf('eq');
    // eq + colorbalance from lookToFilters (cinematic)
    const colorbalanceIdx = types.indexOf('colorbalance');
    // hflip from authored filters
    const hflipIdx = types.indexOf('hflip');

    // Ordering assertions: layers first, then motion, then grade eq, then look (eq + colorbalance), then authored
    expect(drawboxIdx).toBeGreaterThanOrEqual(0);
    expect(drawboxIdx).toBeLessThan(scaleIdx);
    expect(scaleIdx).toBeLessThan(zoompanIdx);
    expect(zoompanIdx).toBeLessThan(eqGradeIdx);
    // the first eq is from grade; look's eq comes after; colorbalance is from look
    expect(eqGradeIdx).toBeLessThan(colorbalanceIdx);
    expect(colorbalanceIdx).toBeLessThan(hflipIdx);
  });

  it('does not double-grade a section that overrides the global grade', async () => {
    const segment = makeSegment();
    const managers = makeManagers();
    // Global grade with a distinctive value; the section defines its OWN grade, so the section's
    // grade must win outright and the global grade must NOT also be baked in (no double-grading).
    const template = makeTemplate({ global: { grade: { contrast: 1.2, saturation: 1.3 } } });
    const { builder } = makeBuilder({ segment, template, managers });
    builder.hydrate({ name: 'clip', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'color_background',
      options: { forceAspectRatio: false, duration: 3 },
      grade: { contrast: 1.05 },
      filters: [],
      maps: [],
    } as never;

    await builder.buildFilters();

    const eqFilters = (segment.filtersList as string[]).filter((s) => s.startsWith('eq='));
    expect(eqFilters).toEqual(['eq=contrast=1.05']);
    expect(eqFilters).not.toContain('eq=contrast=1.2:saturation=1.3');
  });

  it('calibrates Ken Burns on a project_video over the probed clip length, one frame per frame (no stretch)', async () => {
    const segment = makeSegment();
    const managers = makeManagers();
    // Probed clip length 9s while the declared options.duration is 45s: the curve must use the
    // probed 9s and map frames 1:1 (d=1) so the clip is never time-stretched.
    const project = makeProject({ videoConfig: { scale: '1280:720', setsar: '1/1' } }, { clip: 9 });
    const { builder } = makeBuilder({ segment, project, managers });
    builder.hydrate({ name: 'clip', type: 'project_video' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'project_video',
      options: { duration: 45 },
      motion: [{ type: 'kenburns', direction: 'in' }],
      filters: [],
      maps: [],
    } as never;

    await builder.buildFilters();

    const zoompan = (segment.filtersList as string[]).find((s) => s.startsWith('zoompan='));
    expect(zoompan).toBeDefined();
    expect(zoompan).toContain(':d=1:'); // one output frame per input frame — no slow-motion
    expect(zoompan).not.toContain(':d=270:');
    expect(zoompan).toContain('1+0.15*min(it/9,1)'); // calibrated over the probed 9s, not the declared 45s
  });

  it('does not inject sugar filters when look/grade/motion/layers are all absent', async () => {
    const segment = makeSegment();
    const managers = makeManagers();
    const { builder } = makeBuilder({ segment, managers });
    builder.hydrate({ name: 'clip', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'clip',
      type: 'color_background',
      options: { forceAspectRatio: false, duration: 3 },
      filters: [{ type: 'hflip' }],
      maps: [],
    } as never;

    await builder.buildFilters();

    const types = (segment.filtersList as string[]).map((s) => s.split('=')[0]);
    // The CFR frame-grid conform, the authored filter, then the always-on Rec.709 colour-normalisation
    // tag — but no sugar filters (no drawbox, no zoompan, etc.). Neither fps nor setparams is sugar.
    expect(types).toEqual(['fps', 'hflip', 'setparams']);
  });
});

// ---------------------------------------------------------------------------
// buildAudioFadeArg
// ---------------------------------------------------------------------------

describe('SegmentBuilder.buildAudioFadeArg', () => {
  function buildWithSection(section: Section) {
    const { builder } = makeBuilder();
    builder.hydrate(section);
    (builder as unknown as { section: Section }).section = section;

    return (builder as unknown as { buildAudioFadeArg: () => string }).buildAudioFadeArg();
  }

  it('returns empty string when no audioFade options are set', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: { duration: 5 },
    } as Section);

    expect(result).toBe('');
  });

  it('returns empty string when section is muted (muteSection: true)', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: {
        duration: 5,
        muteSection: true,
        audioFade: { in: { duration: 0.5 } },
      },
    } as never);

    expect(result).toBe('');
  });

  it('builds a fade-in -af arg', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: { duration: 5, audioFade: { in: { duration: 0.5 } } },
    } as never);

    expect(result.trim()).toBe('-af "afade=t=in:st=0:d=0.5"');
  });

  it('builds a fade-out -af arg', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: { duration: 5, audioFade: { out: { duration: 0.5 } } },
    } as never);

    expect(result.trim()).toBe('-af "afade=t=out:st=4.5:d=0.5"');
  });

  it('clamps the fade-out start to 0 when the section duration is unknown or shorter than the fade', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: { audioFade: { out: { duration: 0.5 } } },
    } as never);

    expect(result.trim()).toBe('-af "afade=t=out:st=0:d=0.5"');
  });

  it('builds combined fade-in + fade-out as a single comma-joined -af arg', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: {
        duration: 5,
        audioFade: { in: { duration: 0.5 }, out: { duration: 0.5 } },
      },
    } as never);

    expect(result.trim()).toBe('-af "afade=t=in:st=0:d=0.5,afade=t=out:st=4.5:d=0.5"');
  });

  it('appends :curve=<name> when a curve is specified on fade-in', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: {
        duration: 5,
        audioFade: { in: { duration: 0.5, curve: 'qsin' } },
      },
    } as never);

    expect(result.trim()).toBe('-af "afade=t=in:st=0:d=0.5:curve=qsin"');
  });

  it('appends :curve=<name> when a curve is specified on fade-out', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: {
        duration: 5,
        audioFade: { out: { duration: 0.5, curve: 'qsin' } },
      },
    } as never);

    expect(result.trim()).toBe('-af "afade=t=out:st=4.5:d=0.5:curve=qsin"');
  });

  it('does not append :curve when no curve is given', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: {
        duration: 5,
        audioFade: { in: { duration: 1 } },
      },
    } as never);

    expect(result).not.toContain('curve');
  });

  it('builds an echo -af arg when audioEffect is set alone', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: { duration: 5, audioEffect: 'echo' },
    } as never);

    expect(result.trim()).toBe('-af "aecho=0.8:0.7:60:0.4"');
  });

  it('builds a telephone -af arg (two-filter comma chain) when audioEffect is set alone', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: { duration: 5, audioEffect: 'telephone' },
    } as never);

    expect(result.trim()).toBe('-af "highpass=f=300,lowpass=f=3400"');
  });

  it('builds a muffled -af arg when audioEffect is set alone', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: { duration: 5, audioEffect: 'muffled' },
    } as never);

    expect(result.trim()).toBe('-af "lowpass=f=1200"');
  });

  it('orders the effect before the fades in the -af chain', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: {
        duration: 5,
        audioEffect: 'echo',
        audioFade: { in: { duration: 0.5 }, out: { duration: 0.5 } },
      },
    } as never);

    expect(result.trim()).toBe('-af "aecho=0.8:0.7:60:0.4,afade=t=in:st=0:d=0.5,afade=t=out:st=4.5:d=0.5"');
  });

  it('emits no effect when the section is muted, even if audioEffect is set', () => {
    const result = buildWithSection({
      name: 'clip',
      type: 'video',
      options: { duration: 5, muteSection: true, audioEffect: 'echo' },
    } as never);

    expect(result).toBe('');
  });
});
