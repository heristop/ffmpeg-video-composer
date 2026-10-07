// Builder stills for the typed-fields PR: promo.json imported through the template editor's
// "Import template JSON", opened with "Save & film", then the form's typed controls and inline problems.
//
// Run against a dev server of apps/leclap-web (`npx vite --port 5411` there), from the repository root:
//   BASE=http://localhost:5411 node .github/pr-media/typed-fields/record.mjs
// Needs ffmpeg (libwebp) on PATH and a Chromium for @playwright/test (CHROMIUM=/path/to/chrome overrides it).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const MEDIA = path.join(ROOT, '.github/pr-media/typed-fields');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://localhost:5411';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'typed-fields-'));
const PANEL = { x: 68, width: 342 };

function ffmpeg(...args) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
}

function report(name) {
  console.log(`${name}: ${Math.round(fs.statSync(path.join(MEDIA, name)).size / 1024)} KB`);
}

// The editor panel on the left, from its header to a little below its last control (room for a message).
async function panelShot(page, file) {
  const header = await page.getByText('Details', { exact: true }).first().boundingBox();
  const bottom = await page.locator('input:visible, [role=combobox]:visible').evaluateAll(
    (els, maxX) =>
      Math.max(
        ...els
          .map((el) => el.getBoundingClientRect())
          .filter((box) => box.x < maxX)
          .map((box) => box.bottom)
      ),
    PANEL.x + PANEL.width
  );
  const y = header.y - 20;
  const height = Math.round(bottom + 72 - y);
  await page.screenshot({ path: file, clip: { ...PANEL, y, height } });

  return Math.ceil(height * 1.25);
}

async function openScene(page, name) {
  await page.getByText(name, { exact: true }).last().click();
  await page.waitForTimeout(600);
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const context = await browser.newContext({
  viewport: { width: 1280, height: 1080 },
  deviceScaleFactor: 1.25,
  colorScheme: 'dark',
});
const page = await context.newPage();

// 1. Import promo.json in the template editor, then "Save & film" opens it in the builder.
await page.goto(`${BASE}/templates/new`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.getByRole('button', { name: 'Start blank' }).click();
await page.getByRole('button', { name: 'Advanced', exact: true }).click();
await page.locator('input[type=file][accept*=json]').setInputFiles(path.join(MEDIA, 'promo.json'));
await page.getByText('Template imported.').waitFor();
await page.getByRole('button', { name: 'Save & film' }).click();
await page.waitForURL(/\/studio\/new\?template=/);
await page.waitForLoadState('networkidle');

// 2. The form filled with render B's values: text, colour picker, number field with its range, select.
await openScene(page, 'Section');
await page.getByLabel('Title').first().fill('Night Market');
const hex = page.locator('input[type=text]').nth(1);
await hex.fill('ff6f61');
await hex.press('Enter');
await page.locator('input[type=number]').fill('5');
await page.getByRole('combobox').click();
await page.getByRole('option', { name: 'slide-left' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(TMP, 'form.png') });
ffmpeg(
  '-i',
  path.join(TMP, 'form.png'),
  '-vf',
  'scale=1280:-1:flags=lanczos',
  '-c:v',
  'libwebp',
  '-quality',
  '80',
  path.join(MEDIA, '03-builder-form.webp')
);
report('03-builder-form.webp');

// 3. Inline problems: the required title emptied in the form, and an ftp:// link in the
//    "Template inputs" scene (LINK is declared but no form asks for it).
await page.getByLabel('Title').first().fill('');
await page.waitForTimeout(400);
const formHeight = await panelShot(page, path.join(TMP, 'form-invalid.png'));
await openScene(page, 'Template inputs');
await page.locator('input[type=url]').fill('ftp://leclap.dev/night-market');
await page.locator('input[type=url]').blur();
await page.waitForTimeout(400);
const inputsHeight = await panelShot(page, path.join(TMP, 'inputs-invalid.png'));
const h = Math.max(formHeight, inputsHeight);
ffmpeg(
  '-i',
  path.join(TMP, 'form-invalid.png'),
  '-i',
  path.join(TMP, 'inputs-invalid.png'),
  '-filter_complex',
  `[0]pad=iw+24:${h}:0:0:color=0x141416[l];[1]pad=iw:${h}:0:0:color=0x141416[r];[l][r]hstack=inputs=2`,
  '-c:v',
  'libwebp',
  '-quality',
  '80',
  path.join(MEDIA, '04-builder-invalid.webp')
);
report('04-builder-invalid.webp');

await browser.close();
