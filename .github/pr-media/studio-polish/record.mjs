// Captures for the studio polish PR, per screen, at 1440x900 and 390x844 (DSF 2; the studio is
// dark-only). Run once per side against a Vite dev server of apps/leclap-web on that side's code:
//   BASE=http://127.0.0.1:5491 SIDE=before OUT=<scratch>/raw3 node .github/pr-media/studio-polish/record.mjs
// SCREENS picks a comma list (default: all).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://127.0.0.1:5491';
const SIDE = process.env.SIDE ?? 'after';
const OUT = path.resolve(process.env.OUT ?? 'build/pr/studio-polish');
const STILLS = path.join(OUT, SIDE);
const ALL = ['home', 'content', 'media', 'format', 'takes'];
const SCREENS = new Set((process.env.SCREENS ?? ALL.join(',')).split(','));
fs.mkdirSync(STILLS, { recursive: true });

async function still(page, name, w) {
  await page.mouse.move(w - 5, page.viewportSize().height - 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(STILLS, `${name}-${w}.png`) });
}

async function openEditor(page) {
  await page.goto(`${BASE}/studio/new?template=web-app-promo`, { waitUntil: 'networkidle', timeout: 300_000 });
  await page.waitForTimeout(2500);
}

const SAMPLE = path.join(ROOT, 'apps/leclap-web/public/videos/home/mobile-shoot.mp4');

const SHOTS = {
  // Two uploaded takes on the clip scene, the second selected; then the remove confirmation.
  takes: async (page, w) => {
    await openEditor(page);
    await page
      .getByRole('tab', { name: /Show your app/ })
      .last()
      .click();
    await page.waitForTimeout(900);
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles(SAMPLE);
    await page.waitForTimeout(1500);
    await page.locator('input[type=file]').first().setInputFiles(SAMPLE);
    await page.waitForTimeout(2000);
    await page.locator('section[aria-label="Your takes"]').first().scrollIntoViewIfNeeded();
    await still(page, 'takes', w);
    await page
      .getByRole('button', { name: 'Remove take 1' })
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
    await still(page, 'takes-confirm', w);
  },
  home: async (page, w) => {
    await page.goto(`${BASE}/studio`, { waitUntil: 'networkidle', timeout: 300_000 });
    await page.waitForTimeout(1500);
    await still(page, 'home', w);
  },
  content: async (page, w) => {
    await openEditor(page);
    await still(page, 'content', w);
  },
  media: async (page, w) => {
    await openEditor(page);
    await page
      .getByRole('button', { name: /^Media/ })
      .first()
      .click();
    await page.waitForTimeout(900);
    await still(page, 'media', w);
  },
  format: async (page, w) => {
    await openEditor(page);
    await page
      .getByRole('button', { name: /^Format/ })
      .first()
      .click();
    await page.waitForTimeout(900);
    await still(page, 'format', w);
  },
};

const browser = await chromium.launch();

for (const [w, height] of [
  [1440, 900],
  [390, 844],
]) {
  for (const screen of ALL) {
    if (!SCREENS.has(screen)) continue;

    const context = await browser.newContext({
      viewport: { width: w, height },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await SHOTS[screen](page, w);
    await context.close();
    console.log(`${SIDE} ${screen} ${w}: shot`);
  }
}

// The recording: open the editor on a template, then type two answers.
if (process.env.RECORD) {
  const videoDir = path.join(OUT, `${SIDE}-video`);
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    colorScheme: 'dark',
    recordVideo: { dir: videoDir, size: { width: 1024, height: 768 } },
  });
  const page = await context.newPage();
  const t0 = Date.now();
  await openEditor(page);
  const openAt = (Date.now() - t0) / 1000;
  await page.getByPlaceholder('Enter app name').pressSequentially('Notely', { delay: 90 });
  await page.getByPlaceholder('Enter one-line promise').pressSequentially('Notes that keep up', { delay: 60 });
  await page.waitForTimeout(2500);
  const video = page.video();
  await context.close();
  fs.renameSync(await video.path(), path.join(OUT, `${SIDE}.webm`));
  fs.rmSync(videoDir, { recursive: true, force: true });
  console.log(`${SIDE}: recording done, editor at ~${openAt.toFixed(1)} s`);
}

await browser.close();
