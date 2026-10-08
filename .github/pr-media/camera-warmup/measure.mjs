// Usage: node measure.mjs <label> <baseUrl> <outDir> [delayMs]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../../apps/leclap-web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const [label, base, outDir, delayArg] = process.argv.slice(2);
const delay = Number(delayArg ?? 2000);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: `${outDir}/video-${label}`, size: { width: 1280, height: 800 } },
});
await ctx.addInitScript(() => {
  const w = window;
  w.__cam = { longtasks: [], events: [], gum: 0, enumerate: 0, isTypeSupported: 0, mr: 0 };
  const ev = (name) => w.__cam.events.push({ name, t: performance.now() });
  w.__camEv = ev;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__cam.longtasks.push({ start: e.startTime, dur: e.duration });
  }).observe({ type: 'longtask', buffered: true });
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    w.__cam.gum++;
    ev('getUserMedia call');
    const s = await gum(c);
    ev('getUserMedia resolved');
    return s;
  };
  const en = md.enumerateDevices.bind(md);
  md.enumerateDevices = async () => {
    w.__cam.enumerate++;
    return en();
  };
  const its = MediaRecorder.isTypeSupported.bind(MediaRecorder);
  MediaRecorder.isTypeSupported = (t) => {
    w.__cam.isTypeSupported++;
    return its(t);
  };
  const Orig = MediaRecorder;
  w.MediaRecorder = class extends Orig {
    constructor(...a) {
      ev('MediaRecorder new');
      super(...a);
      w.__cam.mr++;
    }
    start(...a) {
      ev('MediaRecorder.start');
      return super.start(...a);
    }
  };
  w.MediaRecorder.isTypeSupported = MediaRecorder.isTypeSupported;
  w.MediaRecorder.isTypeSupported = (t) => {
    w.__cam.isTypeSupported++;
    return its(t);
  };
  // first painted video frame of the live preview
  new MutationObserver(() => {
    const v = document.querySelector('video[aria-label="Live camera preview"]');
    if (v && !v.__watched) {
      v.__watched = true;
      ev('video mounted');
      v.requestVideoFrameCallback(() => ev('first video frame'));
    }
    const b = document.querySelector('button[aria-label="Start recording"]');
    if (b && !b.disabled && !w.__readySeen) {
      w.__readySeen = true;
      ev('record button enabled');
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
});
const page = await ctx.newPage();
await page.goto(`${base}/studio/new`, { waitUntil: 'load', timeout: 120000 });
await page
  .getByRole('button', { name: /Present Yourself Introduce/ })
  .first()
  .click();
await page.getByText('Record your clip').first().click();
const recBtn = page.getByRole('button', { name: /Record with camera/i }).first();
await recBtn.waitFor({ timeout: 60000 });
await page.waitForTimeout(delay); // user reads the step / hovers before clicking
const results = [];
for (const run of ['cold', 'warm']) {
  await page.evaluate(() => {
    window.__cam.events = [];
    window.__cam.longtasks = [];
    window.__readySeen = false;
    window.__cam.gum = 0;
    window.__cam.enumerate = 0;
    window.__cam.isTypeSupported = 0;
  });
  await recBtn.hover();
  await page.waitForTimeout(300);
  const t0 = await page.evaluate(() => performance.now());
  await recBtn.click();
  const start = page.getByRole('button', { name: 'Start recording' });
  await start.waitFor();
  await page.waitForFunction(
    () => window.__readySeen && window.__cam.events.some((e) => e.name === 'first video frame'),
    null,
    { timeout: 30000 }
  );
  if (run === 'cold') await page.screenshot({ path: `${outDir}/${label}-ready.png` });
  const t1 = await page.evaluate(() => performance.now());
  await start.click();
  await page.getByRole('button', { name: 'Stop recording' }).waitFor();
  await page.waitForFunction(() => window.__cam.events.some((e) => e.name === 'MediaRecorder.start'));
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: /Retake/ }).waitFor();
  const data = await page.evaluate(() => window.__cam);
  const rel = (n) => {
    const e = data.events.find((x) => x.name === n);
    return e ? Math.round(e.t - t0) : null;
  };
  const lt = data.longtasks.filter((l) => l.start >= t0 - 50);
  results.push({
    run,
    clickToGetUserMedia: rel('getUserMedia call'),
    getUserMediaResolved: rel('getUserMedia resolved'),
    firstFrame: rel('first video frame'),
    recordReady: rel('record button enabled'),
    startClickToRecorderStart: (() => {
      const e = data.events.find((x) => x.name === 'MediaRecorder.start');
      return e ? Math.round(e.t - t1) : null;
    })(),
    getUserMediaCalls: data.gum,
    enumerateDevices: data.enumerate,
    isTypeSupported: data.isTypeSupported,
    longTasksAfterClick: lt.length,
    longestTask: Math.round(Math.max(0, ...lt.map((l) => l.dur))),
    longTaskTotal: Math.round(lt.reduce((a, l) => a + l.dur, 0)),
    longtasks: lt.map((l) => ({ at: Math.round(l.start - t0), dur: Math.round(l.dur) })),
  });
  await page.getByRole('button', { name: 'Close camera' }).click();
  await page.waitForTimeout(1500);
}
console.log(JSON.stringify({ label, results }, null, 1));
fs.writeFileSync(`${outDir}/${label}.json`, JSON.stringify({ label, results }, null, 1));
await ctx.close();
await browser.close();
