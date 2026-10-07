// Media for the "open a template in the builder from a link" pull request: real links made by
// `leclap studio`, opened in the web builder with Playwright. Writes the WebP stills, the MP4 and the
// animated WebP next to this file; scratch output (PNG frames, the raw WebM) goes to build/pr/open-in-builder.
//
// From the repository root, with a dev server running (`npx vite --port 5394` in apps/leclap-web), the CLI
// built (`packages/leclap-cli/dist`) and ffmpeg (libx264, libwebp) on PATH:
//
//   BASE=http://localhost:5394 node .github/pr-media/open-in-builder/record.mjs
//
// CHROMIUM=/path/to/chrome overrides the browser bundled with @playwright/test.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');

const BASE = (process.env.BASE ?? 'http://localhost:5394').replace(/\/$/, '');
const OUT = import.meta.dirname;
const SCRATCH = path.join(ROOT, 'build/pr/open-in-builder');
const VIEWPORT = { width: 1280, height: 800 };
const CLI = path.join(ROOT, 'packages/leclap-cli/dist/index.js');
const TEMPLATES = path.join(ROOT, 'packages/leclap-creative-kit/src/templates');
// The bundled template shown opening: ten scenes, so there is a strip to scroll through.
const SAMPLE = path.join(TEMPLATES, 'fast-curious.json');

const wait = (page, ms) => page.waitForTimeout(ms);

/** The link `leclap studio <file> --base BASE` prints (its first line). */
function studioLink(file) {
  const out = execFileSync('node', [CLI, 'studio', file, '--base', BASE], { encoding: 'utf8' });
  return out.split('\n')[0].trim();
}

/** A copy of a bundled template that points at files on the author's machine, as a template made locally would. */
function localMediaTemplate() {
  const template = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'photo-backdrop.json'), 'utf8'));
  template.global.music = { name: 'our-theme.mp3', url: '/Users/me/Music/our-theme.mp3' };
  template.sections.find((s) => s.name === 'backdrop').options.pictureUrl = '/Users/me/Pictures/office-backdrop.jpg';
  template.sections.find((s) => s.name === 'video_1').options.videoUrl = '~/Movies/interview-take-3.mov';
  const file = path.join(SCRATCH, 'photo-backdrop-local.json');
  fs.writeFileSync(file, JSON.stringify(template, null, 2));
  return file;
}

// A browser-style address bar above a screenshot, so a still shows the URL the page ended on. Drawn by
// this script around the real capture; the page itself is untouched.
async function withAddressBar(browser, png, url) {
  const page = await browser.newPage({ viewport: { width: VIEWPORT.width, height: VIEWPORT.height + 44 } });
  const img = fs.readFileSync(png).toString('base64');
  await page.setContent(`<!doctype html><body style="margin:0;background:#dfe1e5">
    <div style="height:44px;display:flex;align-items:center;gap:10px;padding:0 14px;box-sizing:border-box;
      font:14px/1 -apple-system,'Segoe UI',Roboto,sans-serif;color:#202124">
      <span style="display:flex;gap:7px">${['#ff5f57', '#febc2e', '#28c840']
        .map((c) => `<i style="width:12px;height:12px;border-radius:50%;background:${c}"></i>`)
        .join('')}</span>
      <div style="flex:1;margin-left:12px;height:30px;border-radius:15px;background:#fff;display:flex;
        align-items:center;padding:0 14px">${url.replace(/^https?:\/\//, '')}</div>
    </div><img style="display:block" src="data:image/png;base64,${img}"></body>`);
  await page.screenshot({ path: png });
  await page.close();
}

function toWebp(png, name, { crop } = {}) {
  const filters = [crop ? `crop=${crop}` : null, 'scale=min(iw\\,1280):-2'].filter(Boolean).join(',');
  const dest = path.join(OUT, `${name}.webp`);
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    png,
    '-vf',
    filters,
    '-c:v',
    'libwebp',
    '-quality',
    '72',
    '-compression_level',
    '6',
    dest,
  ]);
  console.log(`${name}.webp  ${(fs.statSync(dest).size / 1024).toFixed(1)} KB`);
}

async function openPage(browser, options = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light', ...options });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.warn('pageerror:', error.message));
  return { context, page };
}

// The builder is ready once the scene strip lists the template's scenes.
async function builderReady(page) {
  await page.locator('[data-reorder-index="0"]').waitFor({ timeout: 60_000 });
  await wait(page, 1500);
}

async function stills(browser, link) {
  const shot = (name) => path.join(SCRATCH, `${name}.png`);

  // (a) The linked template, opened: the fragment is gone from the address bar.
  {
    const { context, page } = await openPage(browser);
    await page.goto(link);
    await builderReady(page);
    await page.screenshot({ path: shot('01-opened') });
    await withAddressBar(browser, shot('01-opened'), page.url());
    toWebp(shot('01-opened'), '01-opened');

    // (c) A second link arrives while that draft is open: the builder asks first.
    const second = studioLink(path.join(TEMPLATES, 'product-launch.json'));
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, new URL(second).hash);
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).first().waitFor();
    await wait(page, 600);
    await page.screenshot({ path: shot('03-replace-draft') });
    toWebp(shot('03-replace-draft'), '03-replace-draft');
    await context.close();
  }

  // (b) A template that points at files on the author's computer.
  {
    const { context, page } = await openPage(browser);
    await page.goto(studioLink(localMediaTemplate()));
    await builderReady(page);
    await page.getByRole('status').filter({ hasText: /./ }).last().waitFor();
    await page.screenshot({ path: shot('02-rebind') });
    toWebp(shot('02-rebind'), '02-rebind');
    await context.close();
  }

  // (d) A link cut short when it was copied.
  {
    const { context, page } = await openPage(browser);
    await page.goto(link.slice(0, Math.floor(link.length * 0.6)));
    await page.getByRole('alert').waitFor({ timeout: 60_000 });
    await wait(page, 1200);
    await page.screenshot({ path: shot('04-broken-link') });
    toWebp(shot('04-broken-link'), '04-broken-link');
    await context.close();
  }

  // (e) The same link on the French site.
  {
    const { context, page } = await openPage(browser, { locale: 'fr-FR' });
    const url = new URL(link);
    await page.goto(`${url.origin}/fr${url.pathname}${url.hash}`);
    await builderReady(page);
    await page.screenshot({ path: shot('05-french') });
    await withAddressBar(browser, shot('05-french'), page.url());
    toWebp(shot('05-french'), '05-french');
    await context.close();
  }
}

// A caption pill for the recording, since a headless browser has no address bar to show the link in.
// Injected by this script on every page load; the builder itself is untouched.
function installPill() {
  window.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `#oib-pill{position:fixed;left:845px;bottom:215px;z-index:2147483647;max-width:820px;white-space:nowrap;
      transform:translate(-50%,8px);padding:9px 16px;border-radius:12px;background:rgba(16,16,24,.94);
      border:1.5px solid #7C83FD;color:#F5F3F7;font:600 15px/1.4 ui-monospace,'Roboto Mono',monospace;
      box-shadow:0 10px 30px rgba(0,0,0,.45);opacity:0;transition:opacity .25s,transform .25s;pointer-events:none}
      #oib-pill.on{opacity:1;transform:translate(-50%,0)}
      #oib-pill small{display:block;font:500 11px/1.4 ui-monospace,monospace;letter-spacing:.08em;
      text-transform:uppercase;color:#9A9AB0;margin-bottom:2px}`;
    const pill = document.createElement('div');
    pill.id = 'oib-pill';
    document.body.append(style, pill);
  });
  window.__pill = (label, text) => {
    const pill = document.getElementById('oib-pill');
    if (!label) {
      pill.classList.remove('on');
      return;
    }
    const small = document.createElement('small');
    small.textContent = label;
    pill.replaceChildren(small, document.createTextNode(text));
    pill.classList.add('on');
  };
}

const pill = (page, label, text) => page.evaluate(([l, t]) => window.__pill(l, t), [label, text]);

// The take: the Studio page, the link opening, then a walk along the scene strip.
async function recording(browser, link) {
  const dir = path.join(SCRATCH, 'video');
  fs.rmSync(dir, { recursive: true, force: true });
  const { context, page } = await openPage(browser, { recordVideo: { dir, size: VIEWPORT } });
  await page.addInitScript(installPill);
  const recordingStart = Date.now();
  await page.goto(`${BASE}/studio`);
  await wait(page, 1500);
  const started = Date.now();
  const shown = `${link.replace(/^https?:\/\//, '').slice(0, 52)}… (${link.length} characters)`;
  await pill(page, `opening the link from leclap studio ${path.basename(SAMPLE)}`, shown);
  await wait(page, 2000);
  await page.goto(link);
  await page.locator('[data-reorder-index="0"]').waitFor({ timeout: 60_000 });
  await wait(page, 400);
  await pill(page, 'opened as a new draft · address bar now', page.url().replace(/^https?:\/\//, ''));
  await wait(page, 2000);
  await pill(page, '', '');
  const count = await page.locator('[data-reorder-index]').count();
  for (let i = 1; i < count; i += 1) {
    const card = page.locator(`[data-reorder-index="${i}"] [role="button"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await wait(page, 700);
  }
  await wait(page, 500);
  const video = page.video();
  await context.close();
  const webm = await video.path();
  // Keep half a second of the Studio page before the caption appears.
  const from = Math.max(0, (started - 500 - recordingStart) / 1000);
  return { webm, from };
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const link = studioLink(SAMPLE);
  console.log(`link: ${link.slice(0, 80)}… (${link.length} characters)`);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  try {
    // ONLY=stills or ONLY=video regenerates one half.
    if (process.env.ONLY !== 'video') await stills(browser, link);
    if (process.env.ONLY === 'stills') return;
    const { webm, from } = await recording(browser, link);
    const mp4 = path.join(OUT, 'open-in-builder.mp4');
    const common = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', from.toFixed(2), '-i', webm];
    execFileSync('ffmpeg', [
      ...common,
      '-an',
      '-vf',
      'fps=30,scale=1280:-2:flags=lanczos,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '24',
      '-movflags',
      '+faststart',
      mp4,
    ]);
    const preview = path.join(OUT, 'open-in-builder.webp');
    // The preview: the first 8 s of the MP4 (the link opening and the first scenes), small enough to embed.
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      mp4,
      '-t',
      '8',
      '-an',
      '-vf',
      'fps=12,scale=800:-2:flags=lanczos',
      '-c:v',
      'libwebp_anim',
      '-quality',
      '70',
      '-compression_level',
      '6',
      '-loop',
      '0',
      preview,
    ]);
    for (const file of [mp4, preview]) {
      console.log(`${path.basename(file)}  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
    }
  } finally {
    await browser.close();
  }
}

await main();
