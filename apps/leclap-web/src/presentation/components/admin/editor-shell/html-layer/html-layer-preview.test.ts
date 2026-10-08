import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlLayer } from '../../templateEditorModel';

const engine = vi.hoisted(() => ({ render: vi.fn() }));

vi.mock('ffmpeg-video-composer/src/browser.ts', () => ({ renderHtmlLayerPreview: engine.render }));
vi.mock('@/infrastructure/html-engine', () => ({ loadSelfHostedHtmlWasm: 'self-hosted' }));

const { previewHtmlLayer, PREVIEW_CACHE_SIZE } = await import('./html-layer-preview');

const LAYER: HtmlLayer = { id: 'a', html: '<p>{{ city }}</p>', css: 'p { color: red }', width: 200, height: 80 };
const ENV = { global: { theme: 'leclap' }, values: { city: 'Lyon' }, fields: [] };
const PNG = new Uint8Array([137, 80, 78, 71]);

let created = 0;

beforeEach(() => {
  created = 0;
  engine.render.mockReset();
  engine.render.mockResolvedValue({ png: PNG, width: 400, height: 160, findings: [] });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++created}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.startsWith('/fonts/') ? new Response(new Uint8Array([1, 2])) : new Response('', { status: 404 })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('previewHtmlLayer', () => {
  it('draws the layer with the engine, the template theme and values, and the self-hosted wasm', async () => {
    const result = await previewHtmlLayer(LAYER, ENV);
    const [request, options] = engine.render.mock.calls[0];

    expect(result).toEqual({ url: 'blob:1', findings: [] });
    expect(request).toMatchObject({
      html: LAYER.html,
      css: LAYER.css,
      width: 200,
      height: 80,
      global: { theme: 'leclap' },
      values: { city: 'Lyon' },
    });
    expect(options).toEqual({ loadHtmlWasm: 'self-hosted' });
    await expect(request.loadFont('Rubik.ttf')).resolves.toEqual(new Uint8Array([1, 2]));
    expect(fetch).toHaveBeenCalledWith('/fonts/Rubik.ttf');
  });

  it('draws the same layer once', async () => {
    const layer = { ...LAYER, width: 321 };
    const changed = { ...layer, id: 'b', position: '10:10' };

    await previewHtmlLayer(layer, ENV);
    await previewHtmlLayer(changed, ENV);

    expect(engine.render).toHaveBeenCalledTimes(1);
  });

  it('lets go of the oldest previews', async () => {
    for (let index = 0; index <= PREVIEW_CACHE_SIZE; index++) {
      await previewHtmlLayer({ ...LAYER, width: 100 + index }, ENV);
    }

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('reads template images from the served assets as data URIs', async () => {
    await previewHtmlLayer({ ...LAYER, width: 999 }, ENV);
    const [request] = engine.render.mock.calls[0];

    await expect(request.readImage('pictures/missing.png')).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith('/assets/pictures/missing.png');
  });
});
