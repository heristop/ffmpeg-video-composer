// Captures for the brand-kit PR: Generate with AI, opened on a blank template, scrolled to its optional
// "bring your own look" group. The branch adds "Your brand" there; the capture imports a real brand-kit.json
// (`leclap brand https://stripe.com`) and holds on "Brand: Stripe". The merge base has no brand section, so its
// side shows the same spot. Only the local import runs: no API key, no AI call.
//
// Run once per side, against a Vite dev server of apps/leclap-web in that side's worktree:
//   BASE=http://127.0.0.1:5483 SIDE=before OUT=<scratch>/raw KIT=<kit>/brand-kit.json node .github/pr-media/brand-kit/record.mjs
//   BASE=http://127.0.0.1:5484 SIDE=after  OUT=<scratch>/raw KIT=<kit>/brand-kit.json node .github/pr-media/brand-kit/record.mjs
// RECORD_ONLY=1 skips the stills. Writes <OUT>/<side>/dialog-{1440,390}.png and dialog-1440-box.png stills, and
// <OUT>/<side>.webm, the 1024x768 recording build.py turns into the evidence video, plus <OUT>/<side>.json.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://127.0.0.1:5484';
const SIDE = process.env.SIDE ?? 'after';
const OUT = path.resolve(process.env.OUT ?? 'build/pr/brand-kit');
const KIT = process.env.KIT ?? path.resolve('brand-kit/brand-kit.json');
const STILLS = path.join(OUT, SIDE);
fs.mkdirSync(STILLS, { recursive: true });

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

async function glideTo(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await page.waitForTimeout(250);
}

async function glideClick(page, locator) {
  await glideTo(page, locator);
  await locator.click();
}

async function openDialog(page, glide = false) {
  await page.goto(`${BASE}/templates/new`, { waitUntil: 'networkidle', timeout: 300_000 });
  await page.getByRole('button', { name: 'Start blank' }).click();
  await page.waitForTimeout(600);
  const open = page.getByRole('button', { name: 'Generate with AI' }).first();
  await (glide ? glideClick(page, open) : open.click());
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 180_000 });
  await page.waitForTimeout(800);

  return dialog;
}

// The optional group under the plan options: "Match a reference", "Your brand" (branch only), the AI provider.
const bindingGroup = (dialog) =>
  dialog.locator('div.grid.gap-3', { has: dialog.page().getByRole('button', { name: /Match a reference/ }) }).last();

async function scrollToGroup(page, dialog, smooth = false) {
  // The group's top ("Match a reference") to the top of the dialog body, so "Your brand" sits right under it.
  await bindingGroup(dialog).evaluate(
    (el, behavior) => el.scrollIntoView({ block: 'start', behavior }),
    smooth ? 'smooth' : 'auto'
  );
  await page.waitForTimeout(smooth ? 900 : 500);
}

// After only: open "Your brand" and import the kit. Returns false on the merge base, which has no such section.
async function importKit(page, dialog, glide = false) {
  const toggle = dialog.getByRole('button', { name: /Your brand/ });
  if ((await toggle.count()) === 0) return false;

  await (glide ? glideClick(page, toggle) : toggle.click());
  await page.waitForTimeout(500);
  const input = dialog.locator('input[type=file][accept="application/json,.json"]');
  if (glide) await glideTo(page, input);
  await input.setInputFiles(KIT);
  await dialog.getByRole('status').filter({ hasText: /^Brand: / }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);

  return true;
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

// 1. Stills at 1440x900 and 390x844, DSF 2. The editor dialog is dark-only.
for (const [w, h] of process.env.RECORD_ONLY ? [] : [
  [1440, 900],
  [390, 844],
]) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await context.newPage();
  const dialog = await openDialog(page);
  await importKit(page, dialog);
  await scrollToGroup(page, dialog);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(STILLS, `dialog-${w}.png`) });
  if (w === 1440) await bindingGroup(dialog).screenshot({ path: path.join(STILLS, `dialog-${w}-box.png`) });
  console.log(`${SIDE} ${w}: shot`);
  await context.close();
}

// 2. The recording at 1024x768: open the dialog, scroll to the group, import the kit (after), then hold.
const videoDir = path.join(OUT, `${SIDE}-video`);
const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  colorScheme: 'dark',
  recordVideo: { dir: videoDir, size: { width: 1024, height: 768 } },
});
await context.addInitScript(CURSOR);
const page = await context.newPage();
const t0 = Date.now();
const dialog = await openDialog(page, true);
await page.mouse.move(700, 400, { steps: 10 });
await scrollToGroup(page, dialog, true);
const imported = await importKit(page, dialog, true);
if (!imported) await page.waitForTimeout(1600);
await scrollToGroup(page, dialog, true);
const ready = (Date.now() - t0) / 1000;
// Park the pointer clear of the group.
const group = await bindingGroup(dialog).boundingBox();
await page.mouse.move(group.x + group.width - 40, group.y - 30, { steps: 20 });
await page.waitForTimeout(7000);
const video = page.video();
await context.close();
fs.renameSync(await video.path(), path.join(OUT, `${SIDE}.webm`));
fs.rmSync(videoDir, { recursive: true, force: true });
fs.writeFileSync(path.join(OUT, `${SIDE}.json`), JSON.stringify({ readyWallSeconds: ready, imported }, null, 2));
console.log(`${SIDE}: recording done, ready at ~${ready.toFixed(1)} s wall clock`);

await browser.close();
