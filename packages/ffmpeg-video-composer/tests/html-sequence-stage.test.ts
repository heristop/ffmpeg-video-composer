import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { stageHtmlLayer, type HtmlStageContext } from '@/editor/html/stage-html-layer';
import type { HtmlRasteriser, HtmlRasterRequest } from '@/core/html/html-rasteriser';
import type { LayerElement } from '@/core/html/html-element';
import { encodePng } from '@/editor/presets/png-encode';
import { readPngChunks } from '@/editor/html/apng-assemble';

function frame(shade: number): Uint8Array {
  return encodePng({ width: 2, height: 2, channels: 4, data: new Uint8Array(16).fill(shade) });
}

function context(overrides: Partial<HtmlStageContext> = {}, failOnCall = -1) {
  const requests: HtmlRasterRequest[] = [];
  let calls = 0;
  const rasteriser: HtmlRasteriser = {
    version: 'test',
    render: vi.fn(async (request: HtmlRasterRequest) => {
      calls++;

      if (calls === failOnCall) throw new Error('webview gone');

      requests.push(request);

      return { png: frame(requests.length), contentHeight: 10 };
    }),
  };
  const written = new Map<string, Uint8Array>();
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx: HtmlStageContext = {
    filesystem: {
      stat: vi.fn(async (path: string) => written.has(path)),
      writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
        written.set(path, bytes);
      }),
      readFile: vi.fn(async () => new Uint8Array([0])),
      resolveLocalAsset: vi.fn(async () => null),
    },
    logger,
    dir: '/panels',
    section: 'intro',
    lookup: () => undefined,
    defaultFamily: 'Rubik',
    loadFont: vi.fn(async () => new Uint8Array([0])),
    rasteriser,
    memory: new Map(),
    fps: 10,
    ...overrides,
  };

  return { ctx, requests, written, rasteriser, logger };
}

// The transforms of the list items as one request draws them.
function transforms(element: LayerElement): Array<string | undefined> {
  const own = element.type === 'li' ? [element.props.style.transform] : [];
  const nested = (element.props.children ?? []).flatMap((child) =>
    typeof child === 'string' ? [] : transforms(child)
  );

  return [...own, ...nested];
}

const CARD = {
  name: 'list',
  html: '<ul><li data-motion="item">One</li><li data-motion="item">Two</li></ul>',
  width: 300,
  height: 100,
  motion: {
    item: {
      x: [
        { t: 0, v: -40 },
        { t: 0.3, v: 20 },
      ],
      stagger: 0.1,
    },
  },
};

describe('stageHtmlLayer with a motion map', () => {
  it('draws each distinct frame once and stages one animated PNG', async () => {
    const { ctx, requests, written } = context();
    const staged = await stageHtmlLayer({ ...CARD }, ctx);
    const apng = written.get(staged.path) as Uint8Array;

    expect(staged.url).toMatch(/^html-seq:[0-9a-f]{16}$/);
    expect(staged.path).toBe(`/panels/html-${staged.url.slice('html-seq:'.length)}.apng`);
    expect(requests).toHaveLength(5);
    expect(readPngChunks(apng).filter((c) => c.type === 'fcTL')).toHaveLength(5);
    expect(transforms(requests[0].element)).toEqual(['translate(-40px, 0px)', 'translate(-40px, 0px)']);
    expect(transforms(requests[4].element)).toEqual(['translate(20px, 0px)', 'translate(20px, 0px)']);
    expect(JSON.stringify(requests[0].element)).not.toContain('"motion"');
  });

  it('reuses a staged sequence, and draws the same bytes on another host', async () => {
    const first = context();
    const a = await stageHtmlLayer({ ...CARD }, first.ctx);
    const again = await stageHtmlLayer({ ...CARD, name: 'copy' }, first.ctx);
    const second = context();
    const b = await stageHtmlLayer({ ...CARD }, second.ctx);

    expect(again).toEqual(a);
    expect(first.rasteriser.render).toHaveBeenCalledTimes(5);
    expect(b).toEqual(a);
    expect(second.written.get(b.path)).toEqual(first.written.get(a.path));
  });

  it('stages the still in its final state when a frame fails to draw', async () => {
    const { ctx, requests, logger } = context({}, 3);
    const staged = await stageHtmlLayer({ ...CARD }, ctx);

    expect(staged.url).toMatch(/^html:[0-9a-f]{16}$/);
    expect(logger.warn).toHaveBeenCalledWith(
      '[intro][Html] html_motion_static: input "list" shows as a still in its final state: frame 2 failed to draw (webview gone)'
    );
    expect(transforms((requests.at(-1) as HtmlRasterRequest).element)).toEqual([
      'translate(20px, 0px)',
      'translate(20px, 0px)',
    ]);
  });

  it('stages the still when drawing passes its deadline', async () => {
    const times = [0, 0, 130_000];
    const { ctx, logger } = context({ now: () => times.shift() ?? 130_000 });
    const staged = await stageHtmlLayer({ ...CARD }, ctx);

    expect(staged.url).toMatch(/^html:/);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('drawing took over 120 s'));
  });

  it('stages the still, drawing no frame, when the plan is over budget', async () => {
    const { ctx, rasteriser, logger } = context({ fps: 60 });
    const motion = {
      item: {
        x: [
          { t: 0, v: 0 },
          { t: 7.9, v: 790 },
        ],
      },
    };
    const staged = await stageHtmlLayer({ ...CARD, motion }, ctx);

    expect(staged.url).toMatch(/^html:/);
    expect(rasteriser.render).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('475 distinct frames (limit 240)'));
  });

  it('stages a card whose names match nothing as its plain still', async () => {
    const { ctx } = context();
    const ghost = await stageHtmlLayer({ ...CARD, motion: { ghost: CARD.motion.item } }, ctx);
    const plain = await stageHtmlLayer({ ...CARD, motion: undefined }, ctx);

    expect(ghost.url).toMatch(/^html:/);
    expect(ghost.url).toBe(plain.url);
  });

  it('stages the still, saying so, when the frame rate is not a whole number', async () => {
    const { ctx, rasteriser, logger } = context({ fps: 29.97 });
    const staged = await stageHtmlLayer({ ...CARD }, ctx);

    expect(staged.url).toMatch(/^html:/);
    expect(rasteriser.render).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('frame rate (29.97) is not a whole number'));
  });

  it('stages the still when the lead frame is too long for an animated PNG', async () => {
    const { ctx, logger, rasteriser } = context();
    const motion = {
      item: {
        x: [
          { t: 7000, v: 0 },
          { t: 7000.3, v: 20 },
        ],
      },
    };
    const staged = await stageHtmlLayer({ ...CARD, motion }, ctx);

    expect(staged.url).toMatch(/^html:/);
    expect(rasteriser.render).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('its first frame lasts'));
  });

  it('stages the still, with one warning, when the frames pass the byte budget', async () => {
    const big = new Uint8Array(30 * 1024 * 1024);
    const rasteriser: HtmlRasteriser = {
      version: 'test',
      render: vi.fn(async () => ({ png: big, contentHeight: 10 })),
    };
    const { ctx, logger } = context({ rasteriser });
    const staged = await stageHtmlLayer({ ...CARD }, ctx);
    const motionWarnings = logger.warn.mock.calls.filter(([m]) => String(m).includes('html_motion_static'));

    expect(staged.url).toMatch(/^html:/);
    expect(motionWarnings).toHaveLength(1);
    expect(motionWarnings[0][0]).toContain('over 48 MB');
  });

  it('warns once, not per frame, when the content overflows the box', async () => {
    const rasteriser: HtmlRasteriser = {
      version: 'test',
      render: vi.fn(async () => ({ png: frame(1), contentHeight: 500 })),
    };
    const { ctx, logger } = context({ rasteriser });
    const staged = await stageHtmlLayer({ ...CARD }, ctx);
    const overflows = logger.warn.mock.calls.filter(([m]) => String(m).includes('html_overflow'));

    expect(staged.url).toMatch(/^html-seq:/);
    expect(overflows).toEqual([
      ['[intro][Html] html_overflow: the content is 500 px tall in a 100 px box, the rest is cut'],
    ]);
  });

  it.each([0, -5, Number.NaN])('stages the still, saying so, when the frame rate is %s', async (fps) => {
    const { ctx, logger } = context({ fps });
    const staged = await stageHtmlLayer({ ...CARD }, ctx);

    expect(staged.url).toMatch(/^html:/);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the frame rate (' + fps + ') is not positive'));
  });
});
