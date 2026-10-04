import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareTitleJob, renderTitleJob } from '../src/effects/registered-render.js';
import { loadRemotion } from '../src/tools/renderRemotionClip.js';

vi.mock('node:child_process', () => ({
  execFile: (_file: unknown, _args: unknown, _opts: unknown, cb: Function) => cb(null, 'Chromium 123.0.0', ''),
}));
vi.mock('../src/tools/renderRemotionClip.js', () => ({
  loadRemotion: vi.fn(),
  withTimeout: async (_label: string, _ms: number, run: () => Promise<unknown>) => run(),
}));
let dir: string;
let config: any;
let title: any;
const composition = { width: 1280, height: 720, fps: 30, durationInFrames: 300 };
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-effect-render-test-')));
  for (const name of ['background.mp4', 'logo.png', 'font.ttf', 'entry.tsx']) {
    await fs.writeFile(path.join(dir, name), name);
  }
  config = {
    mediaDir: dir,
    outputDir: dir,
    remotionEntry: path.join(dir, 'entry.tsx'),
    allowRemotion: true,
    browserExecutable: '/local/chrome',
    renderTimeoutMs: 1000,
  };
  title = {
    section: {
      name: 'title',
      type: 'effect',
      options: { duration: 10 },
      effect: { id: 'leclap.title-reveal', version: '1.0.0' },
    },
    props: { headline: 'LECLAP', headlineY: 320, logoDelayFrames: 15, entranceDurationFrames: 24, springDamping: 18 },
    assets: {
      background: path.join(dir, 'background.mp4'),
      logo: path.join(dir, 'logo.png'),
      font: path.join(dir, 'font.ttf'),
    },
  };
  vi.mocked(loadRemotion).mockResolvedValue({
    bundle: async (options: any) => {
      await fs.mkdir(options.outDir, { recursive: true });
      await fs.writeFile(path.join(options.outDir, 'bundle.js'), 'trusted code');
      await fs.cp(options.publicDir, path.join(options.outDir, 'public'), { recursive: true });
      return options.outDir;
    },
    ensureBrowser: async () => {
      throw new Error('must use configured browser');
    },
    selectComposition: async () => composition,
    makeCancelSignal: () => ({ cancelSignal: {}, cancel: () => {} }),
    renderMedia: async (options: any) => {
      await fs.writeFile(options.outputLocation, 'mp4');
    },
    renderStill: async (options: any) => {
      await fs.writeFile(options.output, 'png');
    },
  } as never);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
describe('registered immutable Remotion job', () => {
  it('snapshots files, uses fixed props for compose and preview, and produces distinct jobs', async () => {
    const first = await prepareTitleJob(title, config);
    const second = await prepareTitleJob(title, config);
    expect(first.directory).not.toBe(second.directory);
    expect(first.provenance.hash).toBe(second.provenance.hash);
    expect((await fs.stat(path.join(first.directory, 'assets/asset-1.png'))).mtimeMs).toBe(0);
    expect(first.provenance.renderer.browserVersion).toBe('Chromium 123.0.0');
    expect(first.inputProps.background).toBe('asset-0.mp4');
    await fs.writeFile(title.assets.background, 'changed');
    expect(await fs.readFile(path.join(first.serveUrl, 'public/asset-0.mp4'), 'utf8')).toBe('background.mp4');
    const full = await renderTitleJob(first, { kind: 'video' });
    const still = await renderTitleJob(first, { kind: 'still', frame: 42 });
    const range = await renderTitleJob(first, { kind: 'range', from: 30, to: 59 });
    expect(full.metadata.duration).toBe(10);
    expect(range.metadata.duration).toBe(1);
    expect(still.path).toMatch(/\.png$/);
    expect(full.provenance).toEqual(range.provenance);
    expect(full.provenance).toMatchObject({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      compositionId: 'LeclapTitle',
    });
  });
  it('hash changes when source, props, assets or renderer config changes', async () => {
    const first = await prepareTitleJob(title, config);
    const props = await prepareTitleJob({ ...title, props: { ...title.props, headline: 'CHANGED' } }, config);
    expect(first.provenance.hash).not.toBe(props.provenance.hash);
    await fs.writeFile(title.assets.logo, 'changed logo');
    const assets = await prepareTitleJob(title, config);
    expect(first.provenance.hash).not.toBe(assets.provenance.hash);
    const browser = await prepareTitleJob(title, { ...config, browserExecutable: '/other/chrome' });
    expect(assets.provenance.hash).not.toBe(browser.provenance.hash);
  });
  it('rejects source composition metadata mismatch before rendering', async () => {
    const modules = await loadRemotion();
    (modules as any).selectComposition = async () => ({ ...composition, durationInFrames: 299 });
    await expect(prepareTitleJob(title, config)).rejects.toThrow(/1280|300|metadata/);
  });
  it('rejects a pre-aborted job', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareTitleJob(title, config, controller.signal)).rejects.toThrow();
  });
});

it('selects the registered promo composition and hashes registration identity', async () => {
  const modules = await loadRemotion();
  const select = vi.fn(async (_options: any) => composition);
  (modules as any).selectComposition = select;
  const first = await prepareTitleJob(title, config);
  const promo = { ...title, section: { ...title.section, effect: { id: 'leclap.web-app-promo', version: '1.0.0' } } };
  const second = await prepareTitleJob(promo, config);
  expect(select.mock.calls[1][0]).toMatchObject({ id: 'LeclapWebAppPromo' });
  expect(second.provenance.compositionId).toBe('LeclapWebAppPromo');
  expect(second.provenance.hash).not.toBe(first.provenance.hash);
  expect(second.provenance).toMatchObject({ effectId: 'leclap.web-app-promo', effectVersion: '1.0.0' });
});

it('rejects an unregistered composition identity before bundling', async () => {
  const modules = await loadRemotion();
  const bundle = vi.fn();
  (modules as any).bundle = bundle;
  const unknown = { ...title, section: { ...title.section, effect: { id: 'unknown', version: '1.0.0' } } };
  await expect(prepareTitleJob(unknown, config)).rejects.toThrow(/effect_not_registered/);
  expect(bundle).not.toHaveBeenCalled();
});

it('uses prepared custom metadata after JSON IPC without catalog access and hashes mapping and contract', async () => {
  const modules = await loadRemotion();
  const select = vi.fn(async (_options: any) => composition);
  (modules as any).selectComposition = select;
  const custom = JSON.parse(
    JSON.stringify({
      ...title,
      section: { ...title.section, effect: { id: 'studio.product-reveal', version: '1.0.0' } },
      compositionId: 'LeclapProductReveal',
      definitionHash: 'a'.repeat(64),
      props: { headline: 'Product' },
      assets: {},
    })
  );
  config.effectCatalogPath = path.join(dir, 'deleted-catalog.json');
  const first = await prepareTitleJob(custom, config);
  expect(select.mock.calls[0][0].id).toBe('LeclapProductReveal');
  expect(first.provenance).toMatchObject({ compositionId: 'LeclapProductReveal', definitionHash: 'a'.repeat(64) });
  const same = await prepareTitleJob(custom, config);
  expect(same.provenance.hash).toBe(first.provenance.hash);
  const mapping = await prepareTitleJob({ ...custom, compositionId: 'AnotherProduct' }, config);
  const contract = await prepareTitleJob({ ...custom, definitionHash: 'b'.repeat(64) }, config);
  expect(mapping.provenance.hash).not.toBe(first.provenance.hash);
  expect(contract.provenance.hash).not.toBe(first.provenance.hash);
});
it.each([
  { compositionId: 'Invalid_id', definitionHash: 'a'.repeat(64) },
  { compositionId: 'Product', definitionHash: 'invalid' },
  { compositionId: 'Product' },
  { definitionHash: 'a'.repeat(64) },
])('rejects incomplete or invalid prepared metadata %j before bundling', async (metadata) => {
  const modules = await loadRemotion();
  const bundle = vi.fn();
  (modules as any).bundle = bundle;
  await expect(prepareTitleJob({ ...title, ...metadata }, config)).rejects.toThrow(/effect_metadata_invalid/);
  expect(bundle).not.toHaveBeenCalled();
});

it('stages case-distinct custom asset keys into separate files with independent hashes', async () => {
  const upper = path.join(dir, 'upper.png');
  const lower = path.join(dir, 'lower.png');
  await fs.writeFile(upper, 'upper image');
  await fs.writeFile(lower, 'lower image');
  const custom = {
    ...title,
    section: { ...title.section, effect: { id: 'studio.case-assets', version: '1.0.0' } },
    compositionId: 'CaseAssets',
    definitionHash: 'a'.repeat(64),
    props: {},
    assets: { Logo: upper, logo: lower },
  };
  const job = await prepareTitleJob(custom, config);
  const first = String(job.inputProps.Logo);
  const second = String(job.inputProps.logo);
  expect(first.toLowerCase()).not.toBe(second.toLowerCase());
  expect(await fs.readdir(path.join(job.directory, 'assets'))).toHaveLength(2);
  expect(await fs.readFile(path.join(job.serveUrl, 'public', first), 'utf8')).toBe('upper image');
  expect(await fs.readFile(path.join(job.serveUrl, 'public', second), 'utf8')).toBe('lower image');
  expect(job.provenance.assetHashes.Logo).not.toBe(job.provenance.assetHashes.logo);
  const repeated = await prepareTitleJob(custom, config);
  expect(repeated.provenance.hash).toBe(job.provenance.hash);
});
