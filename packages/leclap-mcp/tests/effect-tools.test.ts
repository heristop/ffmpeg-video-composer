import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCustomEffectCatalog } from '../src/effects/custom-effect-catalog.js';
import { registerEditTemplate } from '../src/tools/editTemplate.js';
import { validateEffects } from '../src/effects/title-registry.js';
import { registerCompose } from '../src/tools/composeVideo.js';
import { registerRenderPreview } from '../src/tools/renderPreview.js';
import { registerGetEffectSchema } from '../src/tools/getEffectSchema.js';
import { registerValidateTemplate } from '../src/tools/validateTemplate.js';
import { templateRevision } from '../src/effects/template-revision.js';
import { runRender, runGeometryCheck } from '../src/compose/renderRunner.js';
import type * as ComposerModule from 'ffmpeg-video-composer';
import { nodeGeometryWarnings } from 'ffmpeg-video-composer';
import { runTitleEffect } from '../src/effects/effect-runner.js';
import { probeMedia } from '../src/tools/probeMedia.js';

vi.mock('ffmpeg-video-composer', async (importOriginal) => ({
  ...(await importOriginal<typeof ComposerModule>()),
  nodeGeometryWarnings: vi.fn(async () => []),
}));
vi.mock('../src/compose/renderRunner.js', () => ({ runRender: vi.fn(), runGeometryCheck: vi.fn() }));
vi.mock('../src/tools/probeMedia.js', () => ({
  probeMedia: vi.fn(async () => ({
    durationSeconds: 10,
    videoCodec: 'h264',
    audioCodec: null,
    sampleRate: null,
    sizeBytes: 4,
  })),
}));
vi.mock('../src/effects/effect-runner.js', () => ({ runTitleEffect: vi.fn() }));
let dir: string;
let cfg: any;
let template: any;
function capture(register: any) {
  let handler: any;
  register(
    {
      registerTool: (_name: any, _meta: any, cb: any) => {
        handler = cb;
      },
    },
    cfg
  );
  return handler;
}

function registerEditForEffects(
  server: Parameters<typeof registerEditTemplate>[0],
  config: Parameters<typeof registerCompose>[1]
) {
  registerEditTemplate(server, async (patched, signal) => {
    await validateEffects(patched, config, signal);
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(runGeometryCheck).mockResolvedValue({ ok: true, geometry: { warnings: [], measured: 0 } });
  vi.mocked(nodeGeometryWarnings).mockResolvedValue([]);
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-effect-tool-test-')));
  for (const file of ['background.mp4', 'logo.png', 'font.ttf', 'entry.tsx', 'clip.mp4', 'still.png']) {
    await fs.writeFile(path.join(dir, file), file === 'still.png' ? Buffer.from([137, 80, 78, 71]) : 'test');
  }
  cfg = {
    mediaDir: dir,
    outputDir: dir,
    allowRemotion: true,
    remotionEntry: path.join(dir, 'entry.tsx'),
    renderTimeoutMs: 1000,
  };
  template = {
    global: { orientation: 'landscape', fps: 30, musicEnabled: false },
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
  vi.mocked(runTitleEffect).mockImplementation(async (_title, _config, requests) => ({
    directory: dir,
    provenance: { hash: 'snapshot' } as never,
    results: requests.map((request) => ({
      path: path.join(dir, request.kind === 'still' ? 'still.png' : 'clip.mp4'),
      metadata: { duration: request.kind === 'video' ? 10 : 1 },
      provenance: { hash: 'snapshot' },
    })),
  }));
  vi.mocked(runRender).mockResolvedValue({
    ok: true,
    outputPath: path.join(dir, 'out/output.mp4'),
    durationSeconds: 10,
    sizeBytes: 4,
    videoCodec: 'h264',
    audioCodec: null,
  });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
describe('MCP registered effects', () => {
  it.each([
    ['compose_video', registerCompose],
    ['render_preview', registerRenderPreview],
    ['validate_template', registerValidateTemplate],
    ['edit_template', registerEditForEffects],
  ] as const)('%s cancels an active effect preflight before rendering', async (name, register) => {
    const controller = new AbortController();
    let started = false;
    cfg.renderTimeoutMs = 250;
    vi.mocked(probeMedia).mockImplementationOnce(async (_file, _size, _runner, signal) => {
      started = true;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener(
          'abort',
          () => reject(signal.reason instanceof Error ? signal.reason : new Error('Probe aborted')),
          { once: true }
        )
      );
    });
    const args =
      name === 'edit_template'
        ? {
            template,
            expectedRevision: templateRevision(template),
            effectProps: [{ section: 'title', props: { headline: 'Updated' } }],
          }
        : { template, section: 'title', frames: [0] };
    const pending = capture(register)(args, { mcpReq: { signal: controller.signal } });
    await vi.waitFor(() => expect(started).toBe(true));
    controller.abort(new Error('caller cancelled preflight'));
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('caller cancelled preflight');
    expect(runTitleEffect).not.toHaveBeenCalled();
    expect(runRender).not.toHaveBeenCalled();
  });

  it('compose lowers effect to clip with provenance and leaves authored template unchanged', async () => {
    const raw = structuredClone(template);
    const result = await capture(registerCompose)({ template });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.effectProvenance.title.provenance.hash).toBe('snapshot');
    const [job] = vi.mocked(runRender).mock.calls[0];
    expect(job.template.sections?.[0].type).toBe('project_video');
    expect(job.projectConfig.userVideoPaths).toEqual({ title: path.join(dir, 'clip.mp4') });
    expect(template).toEqual(raw);
  });
  it('propagates worker cache summaries to preview and composition', async () => {
    const original = vi.mocked(runTitleEffect).getMockImplementation()!;
    vi.mocked(runTitleEffect).mockImplementation(async (...args) => ({
      ...(await original(...args)),
      cache: { hits: 1, misses: 0, writes: 0 },
    }));
    const preview = await capture(registerRenderPreview)({ template, section: 'title', frames: [0] });
    expect(preview.structuredContent.cache).toEqual({ hits: 1, misses: 0, writes: 0 });
    const composed = await capture(registerCompose)({ template });
    expect(composed.structuredContent.effectCache).toEqual({ hits: 1, misses: 0, writes: 0 });
  });

  it('aggregates cache summaries across multiple effect sections', async () => {
    template.sections.push({ ...structuredClone(template.sections[0]), name: 'second' });
    const original = vi.mocked(runTitleEffect).getMockImplementation()!;
    vi.mocked(runTitleEffect).mockImplementation(async (...args) => ({
      ...(await original(...args)),
      cache: { hits: 1, misses: 1, writes: 1 },
    }));
    const composed = await capture(registerCompose)({ template });
    expect(composed.structuredContent.effectCache).toEqual({ hits: 2, misses: 2, writes: 2 });
  });

  it('gives older worker mocks zero preview diagnostics', async () => {
    const preview = await capture(registerRenderPreview)({ template, section: 'title', frames: [0] });
    expect(preview.structuredContent.cache).toEqual({ hits: 0, misses: 0, writes: 0 });
  });

  it('invalid later effect rejects before any Remotion rendering', async () => {
    template.sections.push({
      ...structuredClone(template.sections[0]),
      name: 'later',
      effect: { ...structuredClone(template.sections[0].effect), props: { springDamping: 0 } },
    });
    const result = await capture(registerCompose)({ template });
    expect(result.isError).toBe(true);
    expect(runTitleEffect).not.toHaveBeenCalled();
    expect(runRender).not.toHaveBeenCalled();
  });
  it('missing ordinary clip rejects before probing effect assets', async () => {
    template.sections.push({ name: 'ordinary', type: 'project_video', options: { duration: 2 } });
    const result = await capture(registerCompose)({ template });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('ordinary');
    expect(runTitleEffect).not.toHaveBeenCalled();
  });
  it('rejects manual binding collision with an effect', async () => {
    const result = await capture(registerCompose)({ template, userVideoPaths: { title: path.join(dir, 'clip.mp4') } });
    expect(result.isError).toBe(true);
    expect(runTitleEffect).not.toHaveBeenCalled();
  });
  it('preview returns readable images and uses the same job for all requested frames', async () => {
    const result = await capture(registerRenderPreview)({ template, section: 'title', frames: [0, 42, 299] });
    expect(result.isError).toBeUndefined();
    expect(result.content.filter((block: any) => block.type === 'image')).toEqual(
      Array(3).fill({ type: 'image', mimeType: 'image/png', data: 'iVBORw==' })
    );
    expect(runTitleEffect).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runTitleEffect).mock.calls[0][2]).toEqual([
      { kind: 'still', frame: 0 },
      { kind: 'still', frame: 42 },
      { kind: 'still', frame: 299 },
    ]);
  });
  it('range preview returns a video resource link', async () => {
    const result = await capture(registerRenderPreview)({
      template,
      section: 'title',
      frameRange: { from: 0, to: 29 },
    });
    expect(result.content.find((block: any) => block.type === 'resource_link')).toMatchObject({
      mimeType: 'video/mp4',
    });
  });
  it.each([
    { frames: [0, 0] },
    { frames: [300] },
    { frameRange: { from: 0, to: 90 } },
    { frames: [0], frameRange: { from: 0, to: 1 } },
    {},
  ])('rejects invalid preview selection %j', async (selection) => {
    const result = await capture(registerRenderPreview)({ template, section: 'title', ...selection });
    expect(result.isError).toBe(true);
    expect(runTitleEffect).not.toHaveBeenCalled();
  });
  it('stale revision rejects before work', async () => {
    const result = await capture(registerRenderPreview)({
      template,
      section: 'title',
      frames: [0],
      expectedRevision: 'stale',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('revision_conflict');
    expect(runTitleEffect).not.toHaveBeenCalled();
  });
  it('validate returns raw JSON revision and acknowledges unmeasured Remotion text', async () => {
    template.metadata = { custom: 'preserve' };
    const result = await capture(registerValidateTemplate)({ template, render: true });
    expect(result.structuredContent.revision).toBe(templateRevision(template));
    expect(result.structuredContent.render.measured).toBe(0);
    expect(result.content[0].text).toMatch(/Remotion.*not measured/);
    expect(runTitleEffect).not.toHaveBeenCalled();
  });
  it('effect schema exposes defaults and backend limitations', async () => {
    const result = await capture(registerGetEffectSchema)({});
    expect(result.structuredContent.id).toBe('leclap.title-reveal');
    expect(result.structuredContent.assetExtensions.background).toEqual(['.mp4', '.mov', '.webm', '.m4v']);
    expect(result.structuredContent.assetVideoPolicies).toEqual({ background: { minVideoDurationSeconds: 10 } });
    expect(result.structuredContent.props.properties.headline.default).toBe('LECLAP');
    expect(result.structuredContent.output).toMatchObject({ width: 1280, height: 720, fps: 30, durationInFrames: 300 });
  });
});
it('preview artifact size failure cleans the complete job', async () => {
  const file = path.join(dir, 'still.png');
  const handle = await fs.open(file, 'w');
  await handle.truncate(11 * 1024 * 1024);
  await handle.close();
  const result = await capture(registerRenderPreview)({ template, section: 'title', frames: [0] });
  expect(result.isError).toBe(true);
  await expect(fs.stat(dir)).rejects.toThrow();
});
it('compose cleans temporary effect files and retains provenance', async () => {
  await fs.mkdir(path.join(dir, 'bundle'));
  await fs.writeFile(path.join(dir, 'bundle', 'source.js'), 'source');
  await fs.writeFile(path.join(dir, 'provenance.json'), '{}');
  const result = await capture(registerCompose)({ template });
  expect(result.isError).toBeUndefined();
  expect(await fs.readdir(dir)).toEqual(['provenance.json']);
});

it('preserves authored geometry indices for effects and ordinary sections', async () => {
  vi.mocked(nodeGeometryWarnings).mockResolvedValue([
    { path: 'sections[1].caption', message: 'top-level', approx: false },
    { path: 'partials[0].sections[0].caption', message: 'partial', approx: false },
  ] as never);
  template.sections.push({ name: 'outro', type: 'color_background', options: { duration: 2 } });
  const result = await capture(registerValidateTemplate)({ template });
  expect(result.structuredContent.geometry).toContain('sections[1].caption: top-level');
  expect(result.structuredContent.geometry).toContain('partials[0].sections[0].caption: partial');
});

it('discovers the promo schema while rejecting unknown registrations', async () => {
  const handler = capture(registerGetEffectSchema);
  const promo = await handler({ id: 'leclap.web-app-promo', version: '1.0.0' });
  expect(promo.isError).toBeUndefined();
  expect(promo.structuredContent.compositionId).toBe('LeclapWebAppPromo');
  expect(promo.structuredContent.props.properties.cameraZoom.default).toBe(1.06);
  expect(promo.structuredContent.assets.required).toEqual(['screenshot', 'logo', 'font']);
  expect((await handler({ id: 'unknown' })).isError).toBe(true);
});

it.each([false, true])(
  'statically checks effect compositing layers including partials (partial=%s)',
  async (partial) => {
    template.sections[0].filters = [
      {
        type: 'drawtext',
        values: {
          text: { en: 'OFF SCREEN' },
          fontsize: 120,
          x: 1400,
          y: 800,
        },
      },
    ];
    const warningPath = partial ? 'partials[0].sections[0].filters[0]' : 'sections[0].filters[0]';
    vi.mocked(nodeGeometryWarnings).mockImplementation(async (analysis) => {
      const section = (partial ? analysis.partials?.[0].sections?.[0] : analysis.sections?.[0]) as
        | { type?: string; filters?: unknown[] }
        | undefined;
      if (section?.type !== 'effect' || !section.filters?.length) return [];
      return [{ path: warningPath, message: 'Text extends beyond frame', approx: false }] as never;
    });
    if (partial) {
      template.partials = [{ id: 'promo', sections: template.sections }];
      template.sections = [{ type: 'partial', ref: 'promo' }];
    }
    const before = structuredClone(template);
    const result = await capture(registerValidateTemplate)({ template });
    expect(result.structuredContent.geometry).toContain(`${warningPath}: Text extends beyond frame`);
    expect(result.content[0].text).toContain(`${warningPath}: Text extends beyond frame`);
    expect(result.content[0].text).toMatch(/Remotion.*not measured/);
    expect(template).toEqual(before);
    expect(runTitleEffect).not.toHaveBeenCalled();
  }
);

it('retains rendered contrast refinement on ordinary sections alongside effects', async () => {
  template.sections.push({
    name: 'card',
    type: 'color_background',
    options: { duration: 2 },
    caption: { text: { en: 'Read me' }, color: '#ffffff' },
  });
  vi.mocked(nodeGeometryWarnings).mockResolvedValue([
    { path: 'sections[1].caption', message: 'stale static contrast warning', approx: false },
  ] as never);
  vi.mocked(runGeometryCheck).mockResolvedValue({ ok: true, geometry: { warnings: [], measured: 1 } });
  const result = await capture(registerValidateTemplate)({ template, render: true });
  expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
  expect(result.structuredContent.geometry).not.toContain('sections[1].caption: stale static contrast warning');
  expect(result.structuredContent.render.measured).toBe(1);
});

function useCustom() {
  cfg.effectCatalog = parseCustomEffectCatalog({
    schemaVersion: 1,
    effects: [
      {
        id: 'studio.product-reveal',
        version: '1.0.0',
        compositionId: 'LeclapProductReveal',
        description: 'Generic product reveal',
        propsSchema: {
          type: 'object',
          properties: {
            headline: { type: 'string', minLength: 1, maxLength: 80, default: 'Product' },
          },
          additionalProperties: false,
        },
        assets: {},
      },
    ],
  });
  template.sections[0].effect = { id: 'studio.product-reveal', version: '1.0.0', props: {}, assets: {} };
}
it('lists custom effects and exposes their strict schema without rendering', async () => {
  useCustom();
  const handler = capture(registerGetEffectSchema);
  const listed = await handler({ list: true });
  expect(listed.structuredContent.effects).toHaveLength(3);
  expect(listed.structuredContent.effects[2]).toMatchObject({
    id: 'studio.product-reveal',
    description: 'Generic product reveal',
  });
  const schema = await handler({ id: 'studio.product-reveal', version: '1.0.0' });
  expect(schema.structuredContent.props.properties.headline.default).toBe('Product');
  expect((await handler({ list: true, id: 'studio.product-reveal' })).isError).toBe(true);
  expect((await handler({ list: true, version: '1.0.0' })).isError).toBe(true);
  expect(runTitleEffect).not.toHaveBeenCalled();
});
it('validates custom defaults and snapshots serializable composition metadata for preview', async () => {
  useCustom();
  const result = await capture(registerRenderPreview)({ template, section: 'title', frames: [42] });
  expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
  expect(vi.mocked(runTitleEffect).mock.calls[0][0]).toMatchObject({
    compositionId: 'LeclapProductReveal',
    definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    props: { headline: 'Product' },
    assets: {},
  });
});
it('rejects custom invalid props before rendering', async () => {
  useCustom();
  template.sections[0].effect.props = { headline: '' };
  const result = await capture(registerCompose)({ template });
  expect(result.isError).toBe(true);
  expect(runTitleEffect).not.toHaveBeenCalled();
  expect(runRender).not.toHaveBeenCalled();
});
it('patches custom props through the configured snapshot', async () => {
  useCustom();
  let handler: any;
  registerEditTemplate(
    {
      registerTool: (_name: any, _meta: any, cb: any) => {
        handler = cb;
      },
    } as never,
    async (patched) => {
      await validateEffects(patched, cfg);
    }
  );
  const result = await handler({
    template,
    expectedRevision: templateRevision(template),
    effectProps: [{ section: 'title', props: { headline: 'Updated' } }],
  });
  expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
  expect(result.structuredContent.template.sections[0].effect.props.headline).toBe('Updated');
});

it.each(['props', 'assets'])(
  'rejects raw prototype keys in custom %s before schema normalization or rendering',
  async (field) => {
    useCustom();
    template.sections[0].effect[field] = JSON.parse('{"__proto__":{}}');
    const result = await capture(registerCompose)({ template });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('effect_key_unsafe');
    expect(runTitleEffect).not.toHaveBeenCalled();
  }
);

it('discovers custom asset extensions, required slots and explicit video duration policies', async () => {
  cfg.effectCatalog = parseCustomEffectCatalog({
    schemaVersion: 1,
    effects: [
      {
        id: 'studio.asset-scene',
        version: '1.0.0',
        compositionId: 'AssetScene',
        propsSchema: { type: 'object', properties: {}, additionalProperties: false },
        assets: {
          clip: { extensions: ['.mp4'], minVideoDurationSeconds: 12 },
          logo: { extensions: ['.png', '.webp'], required: false },
        },
      },
    ],
  });
  const result = await capture(registerGetEffectSchema)({ id: 'studio.asset-scene', version: '1.0.0' });
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent.assets.required).toEqual(['clip']);
  expect(result.structuredContent.assetExtensions).toEqual({ clip: ['.mp4'], logo: ['.png', '.webp'] });
  expect(result.structuredContent.assetVideoPolicies).toEqual({ clip: { minVideoDurationSeconds: 12 } });
  const text = JSON.parse(result.content[0].text);
  expect(text.assetExtensions).toEqual(result.structuredContent.assetExtensions);
  expect(text.assetVideoPolicies).toEqual(result.structuredContent.assetVideoPolicies);
  expect(runTitleEffect).not.toHaveBeenCalled();
});
