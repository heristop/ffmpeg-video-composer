// Usage: node capture.mjs <before|after> <base-url> <out-dir>
// Scrolls the landing page's render chapter (03) to 100% and stills the wind-up before the slam, then the landed cheer.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../../apps/leclap-web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const [label, base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wheel down until the phone's count reads at least `target` percent; returns when it does.
const scrollTo = async (page, target, step) => {
  const pct = page.locator('[data-scrub="percent"]').first();
  for (let i = 0; i < 400; i++) {
    const value = parseInt((await pct.textContent()) ?? '0', 10);
    if (value >= target) return value;
    await page.mouse.wheel(0, step);
    await sleep(40);
  }
  throw new Error('never reached ' + target);
};

const prime = async (page) => {
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 120000 });
  await sleep(2500);
  // the phone mounts lazily, once the chapter nears the viewport
  for (let i = 0; i < 40 && !(await page.locator('[data-scrub="percent"]').count()); i++) {
    await page.mouse.wheel(0, 400);
    await sleep(150);
  }
  await sleep(800);
};

for (const [name, width, height] of [
  ['1440', 1440, 900],
  ['390', 390, 844],
]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await prime(page);
  await scrollTo(page, 90, 30);
  await scrollTo(page, 99, 6);
  // the very next notch lands 100%: the cheer's wind-up starts, the slam is 0.6 s later
  const pct = page.locator('[data-scrub="percent"]').first();
  while (parseInt((await pct.textContent()) ?? '0', 10) < 100) {
    await page.mouse.wheel(0, 2);
    await sleep(20);
  }
  await sleep(150);
  await page.screenshot({ path: `${outDir}/${label}-${name}-windup.png` });
  await sleep(1800);
  await page.screenshot({ path: `${outDir}/${label}-${name}-landed.png` });
  await ctx.close();
}

// the recording: the scroll through the same moment, 1024x768 so the evidence video's pane is filled
const vdir = `${outDir}/clip-${label}`;
fs.rmSync(vdir, { recursive: true, force: true });
const ctx = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  recordVideo: { dir: vdir, size: { width: 1024, height: 768 } },
});
const page = await ctx.newPage();
await prime(page);
await scrollTo(page, 90, 20);
await scrollTo(page, 99, 4);
await sleep(300);
const pct = page.locator('[data-scrub="percent"]').first();
while (parseInt((await pct.textContent()) ?? '0', 10) < 100) {
  await page.mouse.wheel(0, 2);
  await sleep(20);
}
await sleep(3000);
await ctx.close();
await browser.close();
