#!/usr/bin/env node
// Render the music library's cover illustrations (src/library/covers/<id>.webp): one 512×512 flat vector
// "mood scene" per track, described in music-covers-data.ts as a sky gradient plus a stack of shape layers,
// with the track title (Oswald bold, uppercase) and the artist (Oswald light) in a fixed bottom-left title
// block. Each cover is an inline SVG laid out in an HTML page that embeds the bundled Oswald as a data URI,
// rasterised by Playwright's Chromium and encoded to WebP (quality 80, lowered until it fits 40 KB).
// Output is deterministic: scattered shapes draw from a PRNG seeded by the track id.
//
// Run: npx tsx packages/leclap-creative-kit/scripts/gen-music-covers.ts [--only id,id] [--sheet <file.png>]
// (--sheet also writes a contact sheet of every cover, 6 per row at 256 px, for review).
// Needs an ffmpeg with libwebp on PATH and a Playwright Chromium (`pnpm exec playwright install chromium`).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ABSOLUTE, SHAPES } from './music-covers-shapes.ts';
import { C, SIZE, f, hash, num, seeded, type Ctx } from './music-covers-primitives.ts';
import { COVERS } from './music-covers-data.ts';
import type { CoverSpec } from './music-covers-types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../src/library/covers');
const fontFile = path.resolve(here, '../src/library/fonts/Oswald.ttf');

const MAX_COVER_BYTES = 40 * 1024;
const TITLE_SIZE = 46;

// --- cover assembly --------------------------------------------------------------------------------------

function coverSvg(spec: CoverSpec): string {
  let counter = 0;
  const ctx: Ctx = { rnd: seeded(hash(spec.id)), uid: (prefix) => `${prefix}${(counter += 1)}` };
  const stops = spec.sky
    .map((color, i) => `<stop offset="${f(i / Math.max(1, spec.sky.length - 1))}" stop-color="${color}"/>`)
    .join('');
  const layers = spec.layers
    .map((layer) => {
      const body = SHAPES[layer.shape](layer, ctx);

      if (ABSOLUTE.has(layer.shape)) return body;

      const transform = `translate(${num(layer, 'x', 256)} ${num(layer, 'y', 256)}) rotate(${num(layer, 'rot', 0)}) scale(${num(layer, 's', 1)})`;

      return `<g transform="${transform}" opacity="${num(layer, 'opacity', 1)}">${body}</g>`;
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>` +
    `<linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.ink}" stop-opacity="0"/><stop offset="0.55" stop-color="${C.ink}" stop-opacity="0.72"/><stop offset="1" stop-color="${C.ink}" stop-opacity="0.92"/></linearGradient>` +
    `<rect width="${SIZE}" height="${SIZE}" fill="url(#sky)"/>${layers}<rect y="292" width="${SIZE}" height="${SIZE - 292}" fill="url(#scrim)"/></svg>`
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function coverHtml(spec: CoverSpec, fontData: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Oswald'; src: url(data:font/ttf;base64,${fontData}) format('truetype'); font-weight: 200 700; }
html, body { margin: 0; background: ${C.ink}; }
#cover { position: relative; width: ${SIZE}px; height: ${SIZE}px; overflow: hidden; }
#cover svg { position: absolute; inset: 0; }
.block { position: absolute; left: 40px; right: 40px; bottom: 40px; font-family: 'Oswald'; color: ${C.cream}; }
.bar { width: 36px; height: 5px; border-radius: 3px; background: ${C.pink}; margin-bottom: 12px; }
.title { font-weight: 700; font-size: ${TITLE_SIZE}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.01em; }
.artist { margin-top: 10px; font-weight: 300; font-size: 19px; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.lav2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head><body><div id="cover">${coverSvg(spec)}<div class="block"><div class="bar"></div><div class="title">${escapeHtml(spec.title)}</div><div class="artist">${escapeHtml(spec.artist)}</div></div></div></body></html>`;
}

// --- rendering -------------------------------------------------------------------------------------------

interface Browser {
  newPage(options: { viewport: { width: number; height: number } }): Promise<Page>;
  close(): Promise<void>;
}

interface Page {
  setContent(html: string): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  screenshot(options: { path: string; clip: { x: number; y: number; width: number; height: number } }): Promise<void>;
}

// playwright-core ships with the web app's @playwright/test; the creative kit does not depend on it.
function loadChromium(): { launch(): Promise<Browser> } {
  const anchors = [import.meta.url, path.resolve(here, '../../../apps/leclap-web/package.json')];

  for (const anchor of anchors) {
    for (const name of ['playwright-core', '@playwright/test', 'playwright']) {
      try {
        return createRequire(anchor)(name).chromium;
      } catch {
        // try the next candidate
      }
    }
  }

  throw new Error('Playwright not found: install @playwright/test (apps/leclap-web) or playwright-core');
}

// Runs in the page (the scripts are typed without the DOM lib): wait for Oswald, then shrink the title only
// if it would wrap to three lines; returns the final title size.
const FIT_TITLE = `(async () => {
  await document.fonts.ready;
  const title = document.querySelector('.title');
  let size = ${TITLE_SIZE};
  while (title && title.getBoundingClientRect().height > size * 2.2 && size > 30) {
    size -= 2;
    title.style.fontSize = size + 'px';
  }
  return size;
})()`;

function ffmpeg(args: string[]): void {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' });

  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${run.stderr}`);
}

function encodeWebp(png: string, file: string): number {
  for (const quality of [80, 74, 68, 60, 52]) {
    ffmpeg(['-i', png, '-c:v', 'libwebp', '-quality', `${quality}`, '-compression_level', '6', file]);

    const size = statSync(file).size;

    if (size <= MAX_COVER_BYTES) return size;
  }

  throw new Error(`${path.basename(file)} is over ${MAX_COVER_BYTES} bytes at the lowest quality`);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  return index === -1 ? undefined : process.argv[index + 1];
}

interface Run {
  page: Page;
  fontData: string;
  work: string;
}

async function renderCover({ page, fontData, work }: Run, spec: CoverSpec, index: number): Promise<void> {
  await page.setContent(coverHtml(spec, fontData));

  // Keep the title on two lines at most: shrink it only for the rare title that would wrap to three.
  const titleSize = await page.evaluate<number>(FIT_TITLE);
  const png = path.join(work, `${String(index).padStart(3, '0')}.png`);

  await page.screenshot({ path: png, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });

  const bytes = encodeWebp(png, path.join(outDir, `${spec.id}.webp`));
  const note = titleSize === TITLE_SIZE ? '' : ` (title at ${titleSize}px)`;

  console.log(`${spec.id}.webp ${(bytes / 1024).toFixed(1)} KB${note}`);
}

function contactSheet(work: string, sheet: string): void {
  const filter = 'scale=256:256,tile=6x6:padding=4:color=white';

  ffmpeg(['-framerate', '1', '-i', path.join(work, '%03d.png'), '-vf', filter, '-frames:v', '1', sheet]);
  console.log(`contact sheet: ${sheet}`);
}

async function main(): Promise<void> {
  const only = flag('--only')?.split(',');
  const specs = COVERS.filter((spec) => !only || only.includes(spec.id));
  const work = mkdtempSync(path.join(tmpdir(), 'music-covers-'));
  const browser = await loadChromium().launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  const run: Run = { page, fontData: readFileSync(fontFile).toString('base64'), work };

  mkdirSync(outDir, { recursive: true });

  try {
    // One page renders the covers in turn, so chain them rather than racing setContent calls.
    await specs.reduce<Promise<void>>(
      (previous, spec, index) => previous.then(() => renderCover(run, spec, index)),
      Promise.resolve()
    );

    const sheet = flag('--sheet');

    if (sheet) contactSheet(work, sheet);
  } finally {
    await browser.close();
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
