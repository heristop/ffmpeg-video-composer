import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../apps/leclap-web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const scenarios = {
  both: async () => {
    const t = performance.now();
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    return { gum: performance.now() - t };
  },
  videoOnly: async () => {
    const t = performance.now();
    await navigator.mediaDevices.getUserMedia({ video: true });
    return { gum: performance.now() - t };
  },
  audioOnly: async () => {
    const t = performance.now();
    await navigator.mediaDevices.getUserMedia({ audio: true });
    return { gum: performance.now() - t };
  },
  enumerateThenBoth: async () => {
    const a = performance.now();
    await navigator.mediaDevices.enumerateDevices();
    const e = performance.now() - a;
    await new Promise((r) => setTimeout(r, 1500));
    const t = performance.now();
    await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    return { enumerate: e, gum: performance.now() - t };
  },
  permQueryThenBoth: async () => {
    const a = performance.now();
    await navigator.permissions.query({ name: 'camera' });
    await navigator.permissions.query({ name: 'microphone' });
    const e = performance.now() - a;
    await new Promise((r) => setTimeout(r, 1500));
    const t = performance.now();
    await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    return { perm: e, gum: performance.now() - t };
  },
};
const base = process.argv[2];
for (const [name, fn] of Object.entries(scenarios)) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const browser = await chromium.launch({
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });
    const page = await browser.newPage();
    await page.goto(base + '/favicon.png');
    await page.waitForTimeout(500);
    runs.push(await page.evaluate(fn));
    await browser.close();
  }
  console.log(
    name,
    JSON.stringify(runs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)]))))
  );
}
