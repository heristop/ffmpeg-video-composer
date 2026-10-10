// The built page the phone's hidden WebView runs (dist/html-rasteriser.html): self-contained, and drawing
// the Node golden bytes when driven through its message interface like the app drives it. The scripts run
// in a fresh V8 context with only what a WebView would give them (no Node modules).
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prepareHtmlLayer, HTML_LAYER_DENSITY } from '@/core/html/html-layer';
import { sha256Hex } from '@/core/determinism/sha256';
import { createRasterSession, readRasterReply, type RasterPageReply } from '@/core/html/raster-messages';
import { HTML_RENDERER_VERSION } from '@/core/html/html-engine';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.resolve(here, '../dist/html-rasteriser.html');
const fontsDir = path.resolve(here, '../../leclap-creative-kit/src/library/fonts');

// The golden of tests/html-rasterise-node.test.ts.
const CARD_GOLDEN = '891095981c5265f83ded663654059ba85d26d5f39afe3d2ec393e85164b02885';
const CARD = {
  html: `<div class="card"><span class="tag">For sale</span><p>12 rue des Lilas</p><p class="city">Lyon <strong>3e</strong></p></div>`,
  css:
    '.card { display: flex; flex-direction: column; gap: 12px; padding: 28px; border-radius: 24px; background: #1E1E24 } ' +
    '.tag { color: #FF8AAE; font: 600 28px Rubik } p { margin: 0; font: 56px "Bebas Neue"; color: #F5F3F7 } ' +
    '.city { font: 400 32px Rubik; color: #9A98A6 }',
  width: 360,
  height: 240,
};

// The oldest engines the page supports (docs/on-device-compilation.md#html-layers): Android System WebView
// 87 (Satori needs its Intl.Segmenter) and iOS 16.4's WKWebView (the app's deployment target). Built-ins newer
// than either, deleted from the page's context to stand in for such a WebView; the page polyfills what its
// dependencies need, so it must still draw the golden bytes without them.
const NEWER_THAN_BASELINE = [
  'Promise.withResolvers', // Chrome 119, Safari 17.4
  'Promise.try', // Chrome 128, Safari 18.2
  'Array.prototype.at', // Chrome 92
  'String.prototype.at', // Chrome 92
  'Array.prototype.findLast', // Chrome 97
  'Array.prototype.findLastIndex', // Chrome 97
  'Array.prototype.toSorted', // Chrome 110
  'Array.prototype.toReversed', // Chrome 110
  'Array.prototype.toSpliced', // Chrome 110
  'Array.prototype.with', // Chrome 110
  'Array.fromAsync', // Chrome 121, Safari 16.4
  'Object.hasOwn', // Chrome 93
  'Object.groupBy', // Chrome 117, Safari 17.4
  'Map.groupBy', // Chrome 117, Safari 17.4
  'structuredClone', // Chrome 98
  'String.prototype.isWellFormed', // Chrome 111, Safari 16.4
  'String.prototype.toWellFormed', // Chrome 111, Safari 16.4
];

// Calls to those built-ins in the bundled script, apart from `.at(`: Satori calls `Array.prototype.at`, which
// the page polyfills, and postcss's containers have an `at()` method of their own.
const NEWER_THAN_BASELINE_CALLS = NEWER_THAN_BASELINE.filter((name) => !name.endsWith('.at')).map((name) => ({
  name,
  pattern: name.includes('.prototype.')
    ? new RegExp(String.raw`\.${name.split('.').at(-1)}\(`)
    : new RegExp(String.raw`(?<![\w$.])${name.replaceAll('.', String.raw`\.`)}\b`),
}));

function scripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
}

interface FakeWebView {
  evaluate(code: string): unknown;
  dispatch(text: string): void;
  next(test: (reply: RasterPageReply) => boolean): Promise<RasterPageReply>;
}

// The page in a bare context: a window with addEventListener, a document, and the bridge it posts to.
function loadPage(html: string, { strip = [] as string[] } = {}): FakeWebView {
  const replies: RasterPageReply[] = [];
  const listeners: ((event: { data: string }) => void)[] = [];
  const target = {
    addEventListener: (_type: string, listener: (event: { data: string }) => void) => listeners.push(listener),
  };
  const context = vm.createContext({
    atob,
    performance,
    TextDecoder,
    TextEncoder,
    console,
    setTimeout,
    clearTimeout,
    document: target,
    ReactNativeWebView: { postMessage: (text: string) => replies.push(JSON.parse(text) as RasterPageReply) },
  });
  Object.assign(context, { window: context, self: context, addEventListener: target.addEventListener });

  for (const name of strip) {
    const owner = name.split('.').slice(0, -1).join('.') || 'globalThis';

    vm.runInContext(`delete ${owner}.${name.split('.').at(-1)}`, context);
  }

  for (const code of scripts(html)) vm.runInContext(code, context);

  return {
    evaluate: (code) => vm.runInContext(code, context),
    dispatch: (text) => {
      for (const listener of listeners) listener({ data: text });
    },
    next: (test) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const poll = (): void => {
          const found = replies.find(test);

          if (found) return resolve(found);
          if (Date.now() - started > 20_000) return reject(new Error('the page did not answer'));

          setTimeout(poll, 5);
        };

        poll();
      }),
  };
}

describe('HTML layer WebView page (dist)', () => {
  it('is one self-contained file: no script, stylesheet or WebAssembly to fetch', () => {
    const html = fs.readFileSync(PAGE, 'utf8');

    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
    expect(scripts(html)).toHaveLength(2);
    expect(html).toContain('__LECLAP_RASTER_WASM__');
  });

  it('calls no built-in newer than the oldest supported WebView', () => {
    const [, code] = scripts(fs.readFileSync(PAGE, 'utf8'));
    const found = NEWER_THAN_BASELINE_CALLS.filter(({ pattern }) => pattern.test(code)).map(({ name }) => name);

    expect(found).toEqual([]);
  });

  it('polyfills what its dependencies call on the oldest supported WebView, invisibly', () => {
    const page = loadPage(fs.readFileSync(PAGE, 'utf8'), { strip: NEWER_THAN_BASELINE });

    // Satori's gradient stops (`stops.at(-1)`), which the golden card doesn't reach.
    expect(page.evaluate('JSON.stringify([-1, 0, 1.7, 3, -4].map((index) => [1, 2, 3].at(index)))')).toBe(
      '[3,1,2,null,null]'
    );
    expect(page.evaluate("Object.getOwnPropertyDescriptor(Array.prototype, 'at').enumerable")).toBe(false);
  });

  it.each([
    ['a current WebView', []],
    ['the oldest supported WebView', NEWER_THAN_BASELINE],
  ])(
    'announces its renderer and draws the Node golden bytes from the app messages in %s',
    async (_, strip) => {
      const page = loadPage(fs.readFileSync(PAGE, 'utf8'), { strip });

      await expect(page.next((reply) => reply.type !== 'rendered')).resolves.toEqual({
        type: 'ready',
        version: HTML_RENDERER_VERSION,
      });

      const layer = prepareHtmlLayer(CARD, 'Rubik');
      const fonts = layer.faces.map((face) => ({
        ...face,
        data: new Uint8Array(fs.readFileSync(path.join(fontsDir, face.file))),
      }));
      const session = createRasterSession();
      const request = {
        element: layer.element,
        width: CARD.width,
        height: CARD.height,
        density: HTML_LAYER_DENSITY,
        fonts,
      };

      for (const message of [session.message(request), session.message(request)]) {
        page.dispatch(JSON.stringify(message));
        const raster = readRasterReply(await page.next((reply) => 'id' in reply && reply.id === message.id));

        expect(sha256Hex(raster.png)).toBe(CARD_GOLDEN);
      }
    },
    30_000
  );
});
