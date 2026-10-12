// Evidence for the player's start clap: the showcase film started with a click, recorded at 1024x768 on the base
// branch (before) and on this branch (after). The loader stills come from .github/pr-media/player-logo-loader/.
// Usage (each side's Vite dev server running):
//   node .github/pr-media/player-clap-logo/record.mjs <base-url> <before|after> <out-dir>
import path from 'node:path';
import { mkdirSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');
const [base, side, out] = process.argv.slice(2);

mkdirSync(path.join(out, 'raw'), { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  recordVideo: { dir: out, size: { width: 1024, height: 768 } },
});
const page = await context.newPage();

await page.goto(`${base}/showcase`, { waitUntil: 'networkidle' });
const film = page.locator('video').first();

await film.scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
const box = await film.boundingBox();

await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(2500);
const video = page.video();

await context.close();
renameSync(await video.path(), path.join(out, 'raw', `${side}.webm`));
await browser.close();
console.log(`${side}: ${out}/raw/${side}.webm`);
