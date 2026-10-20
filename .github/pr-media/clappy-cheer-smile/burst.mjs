// Usage: node burst.mjs <before|after> <base-url> <out-dir>
// Desktop stills are timing-sensitive (the wind-up lasts 0.6 s), so shoot the phone in a quick burst after 100%.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../apps/leclap-web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const [label, base, outDir] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
).newPage();
await page.goto(`${base}/`, { waitUntil: 'load', timeout: 120000 });
await sleep(2500);
const pct = page.locator('[data-scrub="percent"]').first();
for (let i = 0; i < 40 && !(await page.locator('[data-scrub="percent"]').count()); i++) {
  await page.mouse.wheel(0, 400);
  await sleep(150);
}
await sleep(800);
const read = async () => parseInt((await pct.textContent()) ?? '0', 10);
while ((await read()) < 90) {
  await page.mouse.wheel(0, 30);
  await sleep(40);
}
while ((await read()) < 99) {
  await page.mouse.wheel(0, 6);
  await sleep(40);
}
await sleep(300);
while ((await read()) < 100) {
  await page.mouse.wheel(0, 2);
  await sleep(20);
}
const clip = { x: 960, y: 150, width: 380, height: 740 };
for (let i = 0; i < 6; i++) await page.screenshot({ path: `${outDir}/${label}-1440-burst${i}.png`, clip });
await browser.close();
