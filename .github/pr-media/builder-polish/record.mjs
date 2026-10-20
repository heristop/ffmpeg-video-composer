// Captures for the builder polish PR: the music panel, the checkbox and editor controls, the program
// transport, the scene strip / panel headers / safe areas, and the viewer's music step, at 1440x900 and
// 390x844 (DSF 2, the studio is dark-only), plus the 1024x768 recording build.py turns into the evidence
// video. Run once per side against a Vite dev server of apps/leclap-web on that side's code:
//   BASE=http://127.0.0.1:5491 SIDE=before OUT=<scratch>/raw node .github/pr-media/builder-polish/record.mjs
//   BASE=http://127.0.0.1:5491 SIDE=after  OUT=<scratch>/raw node .github/pr-media/builder-polish/record.mjs
// RECORD_ONLY=1 skips the stills. Selectors fall back between the two sides where the UI changed.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://127.0.0.1:5491';
const SIDE = process.env.SIDE ?? 'after';
const OUT = path.resolve(process.env.OUT ?? 'build/pr/builder-polish');
const STILLS = path.join(OUT, SIDE);
fs.mkdirSync(STILLS, { recursive: true });

const CURSOR = () => {
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '18px',
    height: '18px',
    marginLeft: '-9px',
    marginTop: '-9px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.9)',
    boxShadow: '0 0 0 3px rgba(146,152,251,0.7)',
    pointerEvents: 'none',
    zIndex: '2147483647',
  });
  const mount = () => document.body?.appendChild(dot);
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('mousemove', (e) => {
    dot.style.left = `${e.clientX}px`;
    dot.style.top = `${e.clientY}px`;
  });
};

async function glideClick(page, locator, glide) {
  if (glide) {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
    await page.waitForTimeout(200);
  }
  await locator.click();
}

async function openPreset(page) {
  await page.goto(`${BASE}/templates/new`, { waitUntil: 'networkidle', timeout: 300_000 });
  await page.getByRole('button', { name: /^Product showcase/ }).click();
  await page.waitForTimeout(1500);
}

// The music scene: a strip card before, the audio lane after.
async function openMusic(page, glide = false) {
  const lane = page.locator('[data-scene-strip] button', { hasText: /Stand-in|offered|Afterword/ });
  const card = page.getByRole('button', { name: /^Music selection/ }).last();
  const target = (await lane.count()) > 0 ? lane.first() : card;
  await target.scrollIntoViewIfNeeded();
  await glideClick(page, target, glide);
  await page.waitForTimeout(900);
}

// Ticks three tracks: checkbox rows after, aria-pressed cards before.
async function tickThree(page, glide = false) {
  const rows = page.locator('[data-music-track] [role=checkbox]');
  const list = (await rows.count()) > 0 ? rows : page.locator('button[aria-pressed]');
  for (const i of [2, 0, 5]) await glideClick(page, list.nth(i), glide);
  await page.waitForTimeout(400);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(STILLS, `${name}.png`) });
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

for (const [w, h] of process.env.RECORD_ONLY
  ? []
  : [
      [1440, 900],
      [390, 844],
    ]) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  // Strip, headers and stage: the opening scene with safe areas on (after).
  await openPreset(page);
  const guides = page.getByRole('button', { name: /^Safe areas$/ });
  if ((await guides.count()) > 0) await guides.click();
  await page.mouse.move(w - 5, h - 5);
  await shot(page, `strip-${w}`);
  if ((await guides.count()) > 0) await guides.click();
  // Music panel: empty, then three ticked.
  await openMusic(page);
  await page.mouse.move(w - 5, h - 5);
  await shot(page, `music-empty-${w}`);
  await tickThree(page);
  await page.mouse.move(w - 5, h - 5);
  await shot(page, `music-selected-${w}`);
  if (w === 1440) {
    await page
      .getByRole('button', { name: /^(Play|Preview) / })
      .nth(1)
      .click();
    await page.waitForTimeout(2500);
    await shot(page, `music-playing-${w}`);
    // Audio panel: sliders, the loudness segments and the ducking checkbox.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Audio', exact: true }).first().click();
    await page.waitForTimeout(800);
    await page.mouse.move(w - 5, h - 5);
    await shot(page, `audio-${w}`);
    // Transport: play the program for two seconds, then pause on the frame.
    await page.getByRole('button', { name: 'Scenes', exact: true }).first().click();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press(' ');
    await page.waitForTimeout(2200);
    await page.keyboard.press(' ');
    await page.waitForTimeout(500);
    await page.mouse.move(w - 5, h - 5);
    await shot(page, `transport-${w}`);
  }
  await context.close();
  // The viewer's music step.
  const viewer = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const vp = await viewer.newPage();
  await vp.goto(`${BASE}/studio/new?template=web-app-promo`, { waitUntil: 'networkidle', timeout: 300_000 });
  await vp.waitForTimeout(2500);
  await vp
    .getByRole('button', { name: /^Media/ })
    .first()
    .click();
  await vp.waitForTimeout(1200);
  await vp.mouse.move(w - 5, h - 5);
  await vp.screenshot({ path: path.join(STILLS, `viewer-${w}.png`) });
  await viewer.close();
  console.log(`${SIDE} ${w}: shot`);
}

// The recording: open the music scene, tick three tracks, preview one, then play the program.
const videoDir = path.join(OUT, `${SIDE}-video`);
const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  colorScheme: 'dark',
  recordVideo: { dir: videoDir, size: { width: 1024, height: 768 } },
});
await context.addInitScript(CURSOR);
const page = await context.newPage();
const t0 = Date.now();
await openPreset(page);
await page.mouse.move(512, 600, { steps: 8 });
await openMusic(page, true);
const ready = (Date.now() - t0) / 1000;
await tickThree(page, true);
const preview = page.getByRole('button', { name: /^(Play|Preview) / }).nth(1);
await glideClick(page, preview, true);
const previewAt = (Date.now() - t0) / 1000;
await page.waitForTimeout(3000);
await page.mouse.move(1000, 740, { steps: 12 });
await page.waitForTimeout(3500);
const video = page.video();
await context.close();
fs.renameSync(await video.path(), path.join(OUT, `${SIDE}.webm`));
fs.rmSync(videoDir, { recursive: true, force: true });
fs.writeFileSync(path.join(OUT, `${SIDE}.json`), JSON.stringify({ musicOpenAt: ready, previewAt }, null, 2));
console.log(`${SIDE}: recording done, music panel at ~${ready.toFixed(1)} s, preview at ~${previewAt.toFixed(1)} s`);
await browser.close();
