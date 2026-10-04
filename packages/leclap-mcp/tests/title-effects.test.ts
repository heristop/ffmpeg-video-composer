import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCustomEffectCatalog } from '../src/effects/custom-effect-catalog.js';
import type { McpConfig } from '../src/config.js';
import { validateEffects, titlePropsSchema } from '../src/effects/title-registry.js';
import { promoPropsSchema } from '../src/effects/promo-registry.js';
import { probeMedia } from '../src/tools/probeMedia.js';

vi.mock('../src/tools/probeMedia.js', () => ({
  probeMedia: vi.fn(async () => ({ durationSeconds: 10, videoCodec: 'h264' })),
}));
let dir: string;
let config: McpConfig;
let template: Record<string, any>;
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-effects-test-')));
  for (const file of ['background.mp4', 'logo.png', 'font.ttf', 'root.tsx']) {
    await fs.writeFile(path.join(dir, file), 'test');
  }
  config = {
    outputDir: dir,
    mediaDir: dir,
    renderTimeoutMs: 1000,
    allowRemotion: true,
    remotionEntry: path.join(dir, 'root.tsx'),
  };
  template = {
    global: { orientation: 'landscape', fps: 30 },
    sections: [
      {
        name: 'title',
        type: 'effect',
        options: { duration: 10 },
        effect: {
          id: 'leclap.title-reveal',
          version: '1.0.0',
          props: {},
          assets: {
            background: path.join(dir, 'background.mp4'),
            logo: path.join(dir, 'logo.png'),
            font: path.join(dir, 'font.ttf'),
          },
        },
      },
    ],
  };
  vi.mocked(probeMedia).mockResolvedValue({
    durationSeconds: 10,
    videoCodec: 'h264',
    audioCodec: null,
    sampleRate: null,
    sizeBytes: 4,
  });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
describe('registered title effect preflight', () => {
  it('applies defaults without changing caller JSON', async () => {
    const copy = structuredClone(template);
    const prepared = await validateEffects(template, config);
    expect(prepared.get('title')?.props).toEqual({
      headline: 'LECLAP',
      headlineY: 320,
      logoDelayFrames: 15,
      entranceDurationFrames: 24,
      springDamping: 18,
    });
    expect(template).toEqual(copy);
  });
  it.each([{ allowRemotion: false }, { remotionEntry: undefined }])(
    'requires configured opt-in backend: %j',
    async (override) => {
      await expect(validateEffects(template, { ...config, ...override })).rejects.toThrow(/Remotion|remotion/);
    }
  );
  it.each([
    ['id', 'unknown'],
    ['version', '2.0.0'],
    ['props', { headline: '' }],
    ['props', { headlineY: 721 }],
    ['props', { logoDelayFrames: 290, entranceDurationFrames: 24 }],
    ['props', { source: 'return 1' }],
    ['assets', { background: 'https://host/x.mp4', logo: 'x.png', font: 'x.ttf' }],
  ])('rejects unsupported or unsafe %s', async (key, value) => {
    template.sections[0].effect[key] = value;
    await expect(validateEffects(template, config)).rejects.toThrow();
  });
  it('rejects extra assets', async () => {
    template.sections[0].effect.assets.script = path.join(dir, 'root.tsx');
    await expect(validateEffects(template, config)).rejects.toThrow();
  });
  it('rejects symlink escape', async () => {
    await fs.symlink('/etc/hosts', path.join(dir, 'escape.png'));
    template.sections[0].effect.assets.logo = path.join(dir, 'escape.png');
    await expect(validateEffects(template, config)).rejects.toThrow(/escapes/);
  });
  it.each([{ fps: 25 }, { orientation: 'portrait' }])('rejects incompatible scene output %j', async (global) => {
    template.global = { ...template.global, ...global };
    await expect(validateEffects(template, config)).rejects.toThrow(/30|landscape/);
  });
  it('rejects short background footage', async () => {
    vi.mocked(probeMedia).mockResolvedValue({
      durationSeconds: 9,
      videoCodec: 'h264',
      audioCodec: null,
      sampleRate: null,
      sizeBytes: 4,
    });
    await expect(validateEffects(template, config)).rejects.toThrow(/10/);
  });
  it('bounds every title timing property', () => {
    expect(titlePropsSchema.safeParse({ springDamping: 0 }).success).toBe(false);
    expect(titlePropsSchema.safeParse({ entranceDurationFrames: 0 }).success).toBe(false);
    expect(titlePropsSchema.safeParse({ logoDelayFrames: -1 }).success).toBe(false);
  });
});
it('resolves relative effect assets under mediaDir and rejects relative traversal', async () => {
  template.sections[0].effect.assets = { background: 'background.mp4', logo: 'logo.png', font: 'font.ttf' };
  const result = await validateEffects(template, config);
  expect(result.get('title')?.assets.logo).toBe(path.join(dir, 'logo.png'));
  template.sections[0].effect.assets.logo = '../../../etc/hosts';
  await expect(validateEffects(template, config)).rejects.toThrow();
});

it('prepares a promo with exact defaults without probing images, alongside a title', async () => {
  const promo = structuredClone(template.sections[0]);
  promo.name = 'promo';
  promo.effect.id = 'leclap.web-app-promo';
  delete promo.effect.assets.background;
  promo.effect.assets.screenshot = 'logo.png';
  vi.mocked(probeMedia).mockClear();
  const only = await validateEffects({ ...template, sections: [promo] }, config);
  expect(probeMedia).not.toHaveBeenCalled();
  expect(only.get('promo')?.props).toEqual({
    brand: 'LeClap',
    eyebrow: 'FROM IDEA TO LAUNCH',
    headline: 'Your next big idea. In motion.',
    subheadline: 'Turn your product into a story worth watching.',
    cta: 'Start creating',
    displayUrl: 'leclap.dev',
    features: ['Design with intent', 'Move with precision', 'Ship something remarkable'],
    accent: '#B9A2FF',
    backgroundColor: '#111120',
    textColor: '#FFFFFF',
    showcaseStartFrame: 90,
    ctaStartFrame: 240,
    entranceDurationFrames: 24,
    springDamping: 20,
    cameraZoom: 1.06,
    cameraTiltDegrees: 8,
  });
  const mixed = await validateEffects({ ...template, sections: [...template.sections, promo] }, config);
  expect([...mixed.keys()]).toEqual(['title', 'promo']);
});
it.each([
  { source: 'return 1' },
  { brand: ' ' },
  { headline: 'x'.repeat(57) },
  { features: ['one', 'two'] },
  { accent: 'red' },
  { showcaseStartFrame: 151 },
  { showcaseStartFrame: 150, ctaStartFrame: 210 },
  { cameraZoom: 1.16 },
  { cameraTiltDegrees: 13 },
])('rejects invalid promo controls %j', async (props) => {
  template.sections[0].effect = {
    id: 'leclap.web-app-promo',
    version: '1.0.0',
    props,
    assets: { screenshot: 'logo.png', logo: 'logo.png', font: 'font.ttf' },
  };
  await expect(validateEffects(template, config)).rejects.toThrow();
});
it.each(['background.mp4', 'https://host/x.png', '../../../etc/hosts', 'root.tsx'])(
  'rejects unsafe promo screenshot %s',
  async (screenshot) => {
    template.sections[0].effect = {
      id: 'leclap.web-app-promo',
      version: '1.0.0',
      props: {},
      assets: { screenshot, logo: 'logo.png', font: 'font.ttf' },
    };
    await expect(validateEffects(template, config)).rejects.toThrow();
  }
);

it('accepts promo boundaries and trims text controls', () => {
  const parsed = promoPropsSchema.parse({
    brand: ' LeClap ',
    showcaseStartFrame: 150,
    ctaStartFrame: 240,
    entranceDurationFrames: 12,
    springDamping: 8,
    cameraZoom: 1,
    cameraTiltDegrees: 0,
  });
  expect(parsed.brand).toBe('LeClap');
  expect(promoPropsSchema.safeParse({ showcaseStartFrame: 150, ctaStartFrame: 239 }).success).toBe(false);
  expect(
    promoPropsSchema.safeParse({
      showcaseStartFrame: 60,
      ctaStartFrame: 260,
      entranceDurationFrames: 36,
      springDamping: 40,
      cameraZoom: 1.15,
      cameraTiltDegrees: 12,
    }).success
  ).toBe(true);
});
it('rejects promo extra assets, symlink escapes, directories and duration mismatch', async () => {
  const effect = {
    id: 'leclap.web-app-promo',
    version: '1.0.0',
    props: {},
    assets: { screenshot: 'logo.png', logo: 'logo.png', font: 'font.ttf' },
  };
  template.sections[0].effect = { ...effect, assets: { ...effect.assets, script: 'root.tsx' } };
  await expect(validateEffects(template, config)).rejects.toThrow();
  await fs.symlink('/etc/hosts', path.join(dir, 'escape.png'));
  template.sections[0].effect = { ...effect, assets: { ...effect.assets, screenshot: 'escape.png' } };
  await expect(validateEffects(template, config)).rejects.toThrow(/escapes/);
  await fs.mkdir(path.join(dir, 'directory.png'));
  template.sections[0].effect = { ...effect, assets: { ...effect.assets, screenshot: 'directory.png' } };
  await expect(validateEffects(template, config)).rejects.toThrow(/regular/);
  template.sections[0].effect = effect;
  template.sections[0].options.duration = 9;
  await expect(validateEffects(template, config)).rejects.toThrow(/LeclapWebAppPromo.*10/);
});

it('applies explicit video policy to any custom key and skips absent optional assets', async () => {
  config.effectCatalog = parseCustomEffectCatalog({
    schemaVersion: 1,
    effects: [
      {
        id: 'studio.video',
        version: '1.0.0',
        compositionId: 'Product',
        propsSchema: { type: 'object', properties: {}, additionalProperties: false },
        assets: {
          footage: { extensions: ['.mp4'], minVideoDurationSeconds: 12 },
          optionalClip: { extensions: ['.mp4'], required: false, minVideoDurationSeconds: 20 },
        },
      },
    ],
  });
  template.sections[0].effect = {
    id: 'studio.video',
    version: '1.0.0',
    props: {},
    assets: { footage: path.join(dir, 'background.mp4') },
  };
  await expect(validateEffects(template, config)).rejects.toThrow(/footage.*12/);
  vi.mocked(probeMedia).mockResolvedValue({ durationSeconds: 12, videoCodec: 'h264' } as never);
  expect((await validateEffects(template, config)).get('title')?.assets).toEqual({
    footage: path.join(dir, 'background.mp4'),
  });
});
it('does not infer a custom video policy from background asset name', async () => {
  config.effectCatalog = parseCustomEffectCatalog({
    schemaVersion: 1,
    effects: [
      {
        id: 'studio.image',
        version: '1.0.0',
        compositionId: 'Product',
        propsSchema: { type: 'object', properties: {}, additionalProperties: false },
        assets: { background: { extensions: ['.png'] } },
      },
    ],
  });
  template.sections[0].effect = {
    id: 'studio.image',
    version: '1.0.0',
    props: {},
    assets: { background: path.join(dir, 'logo.png') },
  };
  vi.mocked(probeMedia).mockClear();
  await validateEffects(template, config);
  expect(probeMedia).not.toHaveBeenCalled();
  template.sections[0].effect.assets = {};
  await expect(validateEffects(template, config)).rejects.toThrow();
});
