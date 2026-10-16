// Captures for the reference-structure PR: "Match a reference" analyses the same real clip
// (footage-edit.mp4, seven shots) in Generate with AI and in the editor's Advanced panel, and the
// ready preview is shot on both sides. Only the in-browser analysis runs: no API key, no AI call.
//
// Run once per side, against a Vite dev server of apps/leclap-web in that side's worktree:
//   BASE=http://127.0.0.1:5481 SIDE=before OUT=<scratch>/raw node .github/pr-media/reference-structure/record.mjs
//   BASE=http://127.0.0.1:5482 SIDE=after  OUT=<scratch>/raw node .github/pr-media/reference-structure/record.mjs
// RECORD_ONLY=1 skips the stills. Writes <OUT>/<side>/{ai,advanced}-{1440,390}{-box,}.png stills and <OUT>/<side>.webm, the 1024x768
// recording build.py turns into the evidence video, plus <OUT>/<side>.json with the ready second.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://127.0.0.1:5482';
const SIDE = process.env.SIDE ?? 'after';
const OUT = path.resolve(process.env.OUT ?? 'build/pr/reference-structure');
const CLIP = process.env.CLIP ?? path.join(ROOT, 'apps/leclap-web/public/videos/showcase/footage-edit.mp4');
const ANALYSIS_TIMEOUT = 300_000;
const STILLS = path.join(OUT, SIDE);
fs.mkdirSync(STILLS, { recursive: true });

const SURFACES = {
  ai: { apply: 'Use as style guide' },
  advanced: { apply: 'Apply as theme' },
};

// Headless recordings show no pointer: draw one and glide it to each target.
const CURSOR = () => {
  const dot = document.createElement('div');
  dot.id = '__cursor';
  Object.assign(dot.style, {
    position: 'fixed', left: '0', top: '0', width: '18px', height: '18px', marginLeft: '-9px', marginTop: '-9px',
    borderRadius: '50%', background: 'rgba(255,255,255,0.9)', boxShadow: '0 0 0 3px rgba(146,152,251,0.7)',
    pointerEvents: 'none', zIndex: '2147483647', transition: 'transform 0.08s',
  });
  const mount = () => document.body?.appendChild(dot);
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('mousemove', (e) => {
    dot.style.left = `${e.clientX}px`;
    dot.style.top = `${e.clientY}px`;
  });
};

async function glideClick(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await page.waitForTimeout(250);
  await locator.click();
}

async function openEditor(page) {
  await page.goto(`${BASE}/templates/new`, { waitUntil: 'networkidle', timeout: 300_000 });
  await page.getByRole('button', { name: 'Start blank' }).click();
  await page.waitForTimeout(600);
}

// Opens the surface's "Match a reference" panel; returns the scope that holds it.
async function openPanel(page, surface, glide = false) {
  const click = (locator) => (glide ? glideClick(page, locator) : locator.click());

  if (surface === 'ai') {
    await click(page.getByRole('button', { name: 'Generate with AI' }).first());
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 180_000 });
    await page.waitForTimeout(800);
    await click(dialog.getByText('Match a reference').first());
    await page.waitForTimeout(500);

    return dialog;
  }

  await click(page.getByRole('button', { name: 'Advanced', exact: true }));
  const section = page.locator('section[aria-labelledby=theme-reference-label]');
  await section.scrollIntoViewIfNeeded();

  return section;
}

async function analyse(page, scope, surface, glide = false) {
  await scope.locator('input[type=file][accept="video/*"]').setInputFiles(CLIP);
  await page.waitForTimeout(400);
  const button = scope.getByRole('button', { name: 'Analyse reference' });
  await (glide ? glideClick(page, button) : button.click());
  await scope.getByRole('button', { name: SURFACES[surface].apply }).waitFor({ timeout: ANALYSIS_TIMEOUT });
}

const readyBox = (scope, surface) =>
  scope.locator('div.rounded-xl', { has: scope.page().getByRole('button', { name: SURFACES[surface].apply }) }).last();

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

// 1. Stills: both surfaces at 1440x900 and 390x844, DSF 2. The editor is dark-only.
// RECORD_ONLY=1 skips them and only redoes the recording.
for (const [w, h] of process.env.RECORD_ONLY ? [] : [
  [1440, 900],
  [390, 844],
]) {
  for (const surface of Object.keys(SURFACES)) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: 'dark' });
    const page = await context.newPage();
    await openEditor(page);
    const scope = await openPanel(page, surface);
    await analyse(page, scope, surface);
    const box = readyBox(scope, surface);
    await box.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(600);
    await box.screenshot({ path: path.join(STILLS, `${surface}-${w}-box.png`) });
    await page.screenshot({ path: path.join(STILLS, `${surface}-${w}.png`) });
    console.log(`${SIDE} ${surface} ${w}: shot`);
    await context.close();
  }
}

// 2. The recording: Generate with AI at 1024x768, the clip picked, analysed, then a hold on the result.
const videoDir = path.join(OUT, `${SIDE}-video`);
const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  colorScheme: 'dark',
  recordVideo: { dir: videoDir, size: { width: 1024, height: 768 } },
});
await context.addInitScript(CURSOR);
const page = await context.newPage();
const t0 = Date.now();
await openEditor(page);
await page.mouse.move(700, 400);
const scope = await openPanel(page, 'ai', true);
await analyse(page, scope, 'ai', true);
const ready = (Date.now() - t0) / 1000;
await page.waitForTimeout(500);
const box = readyBox(scope, 'ai');
await box.evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'smooth' }));
await page.waitForTimeout(900);
// Park the pointer in the empty corner above the result, clear of every line in it.
const target = await box.boundingBox();
await page.mouse.move(target.x + target.width - 40, target.y - 30, { steps: 20 });
await page.waitForTimeout(6000);
const video = page.video();
await context.close();
fs.renameSync(await video.path(), path.join(OUT, `${SIDE}.webm`));
fs.rmSync(videoDir, { recursive: true, force: true });
fs.writeFileSync(path.join(OUT, `${SIDE}.json`), JSON.stringify({ readyWallSeconds: ready }, null, 2));
console.log(`${SIDE}: recording done, ready at ~${ready.toFixed(1)} s wall clock`);

await browser.close();
