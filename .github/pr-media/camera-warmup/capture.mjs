import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../../apps/leclap-web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const [label, base, outDir] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const vdir = `${outDir}/clip-${label}`;
fs.rmSync(vdir, { recursive: true, force: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: vdir, size: { width: 1280, height: 800 } },
});
await ctx.addInitScript(
  (lbl) => {
    addEventListener(
      'pointerdown',
      (e) => {
        if (
          !e.target.closest ||
          !e.target.closest('button') ||
          !/Record with camera/i.test(e.target.closest('button').textContent)
        )
          return;
        const t0 = performance.now();
        const box = document.createElement('div');
        box.style.cssText =
          'position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:2147483647;background:rgba(0,0,0,.82);color:#fff;font:600 22px system-ui;padding:10px 18px;border-radius:12px;pointer-events:none;white-space:nowrap';
        document.documentElement.appendChild(box);
        let first = null;
        let watched = false;
        const tick = () => {
          const v = document.querySelector('video[aria-label="Live camera preview"]');
          if (v && !watched) {
            watched = true;
            v.requestVideoFrameCallback(() => {
              first = Math.round(performance.now() - t0);
            });
          }
          const now = Math.round(performance.now() - t0);
          box.textContent = `${lbl} | ${first === null ? now + ' ms since click - waiting for camera' : 'first camera frame at ' + first + ' ms'}`;
          if (now < 2500) requestAnimationFrame(tick);
        };
        tick();
      },
      true
    );
  },
  label === 'before' ? 'BEFORE' : 'AFTER'
);
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(`${base}/studio/new`, { waitUntil: 'load', timeout: 120000 });
await page
  .getByRole('button', { name: /Present Yourself Introduce/ })
  .first()
  .click();
await page.getByText('Record your clip').first().click();
const recBtn = page.getByRole('button', { name: /Record with camera/i }).first();
await recBtn.waitFor();
await page.waitForTimeout(2000);
await recBtn.hover();
await page.waitForTimeout(300);
const tClick = Date.now();
await recBtn.click();
await page.getByRole('button', { name: 'Start recording' }).waitFor();
await page.waitForFunction(() => !document.querySelector('button[aria-label="Start recording"]').disabled);
const tReady = Date.now();
await page.waitForTimeout(1500);
await ctx.close();
await browser.close();
const file = fs.readdirSync(vdir).find((f) => f.endsWith('.webm'));
fs.writeFileSync(
  `${vdir}/meta.json`,
  JSON.stringify({ video: `${vdir}/${file}`, clickAt: (tClick - t0) / 1000, readyAfterMs: tReady - tClick })
);
console.log(label, 'click->ready', tReady - tClick, 'ms');
