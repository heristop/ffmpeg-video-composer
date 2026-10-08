// The builder still: the pinned template opened in the web builder (through the dev polyfill's WebMCP
// testing shim, `replace_template` allowed in the page), its video scene selected and the Captions
// disclosure open. Writes a 2x PNG of the left panel; make-media.sh crops it to WebP.
//   BASE=http://localhost:5394 node .github/pr-media/auto-captions/builder-still.mjs <out.png>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://localhost:5394';
const OUT = process.argv[2];
const template = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'talk.pinned.json'), 'utf8'));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await context.newPage();
await page.addInitScript(() => {
  window.__webMCPPolyfillOptions = { installTestingShim: true };
  localStorage.setItem('leclap-theme', 'dark');
});
await page.goto(`${BASE}/studio/builder?webmcp=polyfill`);
await page.getByRole('dialog').getByRole('button', { name: 'Start blank' }).click();
await page.waitForFunction(() => navigator.modelContextTesting?.listTools().length > 10, null, { timeout: 60000 });

const call = (name, args) =>
  page.evaluate(([n, a]) => navigator.modelContextTesting.executeTool(n, a), [name, JSON.stringify(args)]);
const replaced = call('replace_template', { template, name: 'Auto-captions', note: 'Pinned talk' });
await page
  .getByRole('dialog', { name: 'Allow this browser agent action?' })
  .getByRole('button', { name: 'Allow', exact: true })
  .click({ timeout: 30000 });
await replaced;
// The builder renames sections (talk becomes clip_1): select the video scene by position.
await call('select_section', { position: 1 });
await page.waitForTimeout(1500);

const disclosure = page.getByRole('button', { name: /Captions/ }).first();
await disclosure.scrollIntoViewIfNeeded();
await disclosure.click();
await page.waitForTimeout(800);
await disclosure.evaluate((el) => el.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(500);
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 640, height: 1000 } });
await browser.close();
