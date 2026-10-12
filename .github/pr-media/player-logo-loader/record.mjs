// Evidence for the player's stall loader: the showcase player forced into its "waiting" state, recorded and shot
// on the base branch (before) and on this branch (after).
// Usage (each side's Vite dev server running):
//   node .github/pr-media/player-logo-loader/record.mjs <base-url> <before|after> <out-dir>
// Writes <out-dir>/<side>.webm (1024x768 recording) and <side>-<viewport>-<theme>.png stills.
import path from 'node:path';
import { mkdirSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');
const [base, side, out] = process.argv.slice(2);

mkdirSync(out, { recursive: true });

// The player shows its loader on the media element's `waiting` event: fire it on the showcase film, as a real
// stall would, so both sides show the same state on the same frame of the same film.
async function stall(page) {
  await page.goto(`${base}/showcase`, { waitUntil: 'networkidle' });
  await page.locator('video').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const video = document.querySelector('video');

    video.pause();
    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('waiting'));
  });
  await page.locator('[role="status"]').first().waitFor();
  await page.waitForTimeout(700);
}

const browser = await chromium.launch();

for (const [name, viewport, colorScheme] of [
  ['1440-light', { width: 1440, height: 900 }, 'light'],
  ['1440-dark', { width: 1440, height: 900 }, 'dark'],
  ['390-light', { width: 390, height: 844 }, 'light'],
]) {
  const page = await browser.newPage({ viewport, colorScheme, deviceScaleFactor: 2 });

  await stall(page);
  const box = await page.locator('video').first().boundingBox();

  await page.screenshot({
    path: path.join(out, `${side}-${name}.png`),
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  await page.close();
}

const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  recordVideo: { dir: out, size: { width: 1024, height: 768 } },
});
const page = await context.newPage();

await stall(page);
await page.waitForTimeout(3500);
const video = page.video();

await context.close();
renameSync(await video.path(), path.join(out, `${side}.webm`));
await browser.close();
console.log(`${side}: ${out}`);
