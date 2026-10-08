import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prepareHtmlLayer, HTML_LAYER_DENSITY } from '@/core/html/html-layer';
import { sha256Hex } from '@/core/determinism/sha256';
import type { HtmlRasterRequest, RasterFont } from '@/core/html/html-rasteriser';
import { base64ToBytes, bytesToBase64 } from '@/editor/html/base64';
import {
  createRasterSession,
  readRasterReply,
  type RasterPageReply,
  type RasterRenderMessage,
} from '@/core/html/raster-messages';
import { createRasterPage } from '@/core/html/raster-page';
import { createNodeHtmlRasteriser } from '@/services/html-node/html-rasteriser-node';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(here, '../../leclap-creative-kit/src/library/fonts');

const CARD = {
  html: `<div class="card"><span class="tag">For sale</span><p>12 rue des Lilas</p><p class="city">Lyon <strong>3e</strong></p></div>`,
  css:
    '.card { display: flex; flex-direction: column; gap: 12px; padding: 28px; border-radius: 24px; background: #1E1E24 } ' +
    '.tag { color: #FF8AAE; font: 600 28px Rubik } p { margin: 0; font: 56px "Bebas Neue"; color: #F5F3F7 } ' +
    '.city { font: 400 32px Rubik; color: #9A98A6 }',
  width: 360,
  height: 240,
};

// The golden of tests/html-rasterise-node.test.ts: the page must draw the very same bytes.
const CARD_GOLDEN = '891095981c5265f83ded663654059ba85d26d5f39afe3d2ec393e85164b02885';

function cardRequest(): HtmlRasterRequest {
  const layer = prepareHtmlLayer(CARD, 'Rubik');
  const fonts: RasterFont[] = layer.faces.map((face) => ({
    ...face,
    data: new Uint8Array(fs.readFileSync(path.join(fontsDir, face.file))),
  }));

  return { element: layer.element, width: CARD.width, height: CARD.height, density: HTML_LAYER_DENSITY, fonts };
}

// A page over the Node engines, talking JSON strings like the WebView does.
function nodePage(): { send: (message: RasterRenderMessage) => Promise<RasterPageReply> } {
  const replies: RasterPageReply[] = [];
  const handle = createRasterPage(
    createNodeHtmlRasteriser(),
    (reply) => replies.push(JSON.parse(reply)),
    () => performance.now()
  );

  return {
    send: async (message) => {
      await handle(JSON.stringify(message));

      return replies.at(-1) as RasterPageReply;
    },
  };
}

describe('base64', () => {
  it('round-trips every byte value and every padding length', () => {
    const bytes = Uint8Array.from({ length: 259 }, (_, index) => (index * 37) % 256);

    for (const length of [0, 1, 2, 3, 4, 258, 259]) {
      const slice = bytes.slice(0, length);

      expect(base64ToBytes(bytesToBase64(slice))).toEqual(slice);
    }
  });
});

describe('HTML raster page', () => {
  it('draws the Node golden bytes from a serialised request', async () => {
    const page = nodePage();
    const session = createRasterSession();
    const reply = await page.send(session.message(cardRequest()));
    const raster = readRasterReply(reply);

    expect(sha256Hex(raster.png)).toBe(CARD_GOLDEN);
    expect(raster.contentHeight).toBeLessThanOrEqual(CARD.height);
  }, 30_000);

  it('sends each font once per session and the page keeps it', async () => {
    const page = nodePage();
    const session = createRasterSession();
    const first = session.message(cardRequest());
    const second = session.message(cardRequest());

    expect(first.fonts.every((font) => typeof font.data === 'string')).toBe(true);
    expect(second.fonts.every((font) => font.data === undefined)).toBe(true);

    await page.send(first);
    const raster = readRasterReply(await page.send(second));

    expect(sha256Hex(raster.png)).toBe(CARD_GOLDEN);
  }, 30_000);

  it('answers a font it never received with a failure naming it', async () => {
    const page = nodePage();
    const sent = createRasterSession();

    sent.message(cardRequest());
    const reply = await page.send(sent.message(cardRequest()));

    expect(reply).toMatchObject({ type: 'failed', id: 2 });
    expect(() => readRasterReply(reply)).toThrow(/font .*\.ttf was not sent/);
  });

  it('numbers its requests', () => {
    const session = createRasterSession();

    expect(session.message(cardRequest()).id).toBe(1);
    expect(session.message(cardRequest()).id).toBe(2);
  });
});
