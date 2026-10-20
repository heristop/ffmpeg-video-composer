// Captures for the second builder polish PR, per screen, at 1440x900 and 390x844 (DSF 2; the studio is
// dark-only). Run once per side against a Vite dev server of apps/leclap-web on that side's code:
//   BASE=http://127.0.0.1:5491 SIDE=before OUT=<scratch>/raw2 SCREENS=form node .github/pr-media/builder-polish-2/record.mjs
// SCREENS picks a comma list of screens (default: all). RECORD=1 also writes the 1024x768 recording.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://127.0.0.1:5491';
const SIDE = process.env.SIDE ?? 'after';
const OUT = path.resolve(process.env.OUT ?? 'build/pr/builder-polish-2');
const STILLS = path.join(OUT, SIDE);
const SCREENS = new Set((process.env.SCREENS ?? 'form').split(','));
fs.mkdirSync(STILLS, { recursive: true });

async function openPreset(page, name = /^Product showcase/) {
  await page.goto(`${BASE}/templates/new`, { waitUntil: 'networkidle', timeout: 300_000 });
  await page.getByRole('button', { name }).click();
  await page.waitForTimeout(1500);
}

// Adds a form scene from the strip's Add scene menu and selects it.
async function addFormScene(page) {
  await page
    .getByRole('button', { name: /^Add scene$/ })
    .first()
    .click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: /Form/ }).first().click();
  await page.waitForTimeout(900);
}

async function tool(page, name) {
  await page.getByRole('button', { name, exact: true }).first().click();
  await page.waitForTimeout(700);
}

async function still(page, name, w) {
  await page.mouse.move(w - 5, h(page) - 5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(STILLS, `${name}-${w}.png`) });
}

const SHOTS = {
  templates: async (page, w) => {
    await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle', timeout: 300_000 });
    await page.waitForTimeout(1200);
    await still(page, 'templates', w);
  },
  presets: async (page, w) => {
    await page.goto(`${BASE}/templates/new`, { waitUntil: 'networkidle', timeout: 300_000 });
    await page.waitForTimeout(1200);
    await still(page, 'presets', w);
  },
  basics: async (page, w) => {
    await openPreset(page);
    await tool(page, 'Basics');
    await still(page, 'basics', w);
  },
  // Two variables: one shown on screen once a caption uses it, one not used.
  variables: async (page, w) => {
    await openPreset(page);
    await tool(page, 'Variables');
    await page
      .getByRole('button', { name: /Add variable/ })
      .first()
      .click();
    await page.keyboard.type('brand');
    await page
      .getByRole('button', { name: /Add variable/ })
      .first()
      .click();
    await page.keyboard.type('brand name');
    await still(page, 'variables', w);
  },
  advanced: async (page, w) => {
    await openPreset(page);
    await tool(page, 'Advanced');
    await still(page, 'advanced', w);
  },
  video: async (page, w) => {
    await openPreset(page);
    await page
      .getByRole('button', { name: /^Your video/ })
      .last()
      .click();
    await page.waitForTimeout(800);
    await still(page, 'video', w);
  },
  image: async (page, w) => {
    await openPreset(page);
    await still(page, 'image', w);
  },
  color: async (page, w) => {
    await openPreset(page, /^Talking-head intro/);
    await still(page, 'color', w);
  },
  help: async (page, w) => {
    await openPreset(page);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('?');
    await page.waitForTimeout(600);
    await still(page, 'help', w);
  },
  ai: async (page, w) => {
    await openPreset(page);
    await page
      .getByRole('button', { name: /Generate with AI/ })
      .first()
      .click();
    await page.waitForTimeout(1200);
    await still(page, 'ai', w);
  },
  // Two fields: "Your topic", then "Price" (a number field where the side offers types).
  form: async (page, w) => {
    await openPreset(page);
    await addFormScene(page);
    await page.getByLabel('Field label').first().fill('Your topic');
    await page.getByRole('button', { name: /Add field/ }).click();
    await page.waitForTimeout(300);
    await page.getByLabel('Field label').last().fill('Price');
    const type = page.getByRole('combobox', { name: 'Type' }).last();
    if ((await type.count()) > 0) {
      await type.click();
      await page.getByRole('option', { name: 'Number' }).click();
      await page.getByLabel('Default').last().fill('24');
    }
    await page.mouse.move(w - 5, h(page) - 5);
    await page
      .locator('.panel-swap')
      .first()
      .evaluate((el) => el.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(STILLS, `form-${w}.png`) });
  },
};

function h(page) {
  return page.viewportSize().height;
}

const browser = await chromium.launch();

for (const [w, height] of [
  [1440, 900],
  [390, 844],
]) {
  for (const screen of Object.keys(SHOTS)) {
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

// The recording: add a form scene, name its field, add a second one (a number with a default where the
// side offers types), then open the shortcut sheet.
if (process.env.RECORD) {
  const videoDir = path.join(OUT, `${SIDE}-video`);
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    colorScheme: 'dark',
    recordVideo: { dir: videoDir, size: { width: 1024, height: 768 } },
  });
  const page = await context.newPage();
  const t0 = Date.now();
  await openPreset(page);
  await addFormScene(page);
  const formAt = (Date.now() - t0) / 1000;
  await page.getByLabel('Field label').first().fill('Your topic');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Add field/ }).click();
  await page.waitForTimeout(400);
  await page.getByLabel('Field label').last().pressSequentially('Price', { delay: 60 });
  const type = page.getByRole('combobox', { name: 'Type' }).last();
  if ((await type.count()) > 0) {
    await type.click();
    await page.getByRole('option', { name: 'Number' }).click();
    await page.getByLabel('Default').last().pressSequentially('24', { delay: 80 });
  }
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('?');
  await page.waitForTimeout(2500);
  const video = page.video();
  await context.close();
  fs.renameSync(await video.path(), path.join(OUT, `${SIDE}.webm`));
  fs.rmSync(videoDir, { recursive: true, force: true });
  console.log(`${SIDE}: recording done, form scene at ~${formAt.toFixed(1)} s`);
}

await browser.close();
