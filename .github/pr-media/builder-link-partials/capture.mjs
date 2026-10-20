// Stills for the "Fast & Curious builder link" pull request: the link `leclap studio` prints for the
// bundled template, opened in the web builder. Run once per side (LABEL=before|after) against a dev
// server, then combine with make-media.sh.
//
//   BASE=http://localhost:5481 LABEL=before node .github/pr-media/builder-link-partials/capture.mjs
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const { chromium } = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'))('@playwright/test');
const BASE = (process.env.BASE ?? 'http://localhost:5481').replace(/\/$/, '');
const LABEL = process.env.LABEL ?? 'after';
const OUT = path.join(ROOT, 'build/pr/blp');
const CLI = path.join(ROOT, 'packages/leclap-cli/dist/index.js');
const TEMPLATE = path.join(ROOT, 'packages/leclap-creative-kit/src/templates/fast-curious.json');
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } };

const link = execFileSync('node', [CLI, 'studio', TEMPLATE, '--base', BASE], { encoding: 'utf8' })
  .split('\n')[0]
  .trim();
const browser = await chromium.launch();

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(link, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, `${LABEL}-${name}.png`) });
  await context.close();
}

await browser.close();
