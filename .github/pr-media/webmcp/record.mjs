// Records the builder footage for the WebMCP reel: a browser agent (the dev polyfill's testing shim)
// calls the builder's WebMCP tools while Chrome screencasts the page. Each take is a separate MP4 under
// build/pr/webmcp/assets/videos/webmcp, which the reel template plays as `video` sections.
//
// Run by make-media.sh against a dev server (`npx vite --port 5393` in apps/leclap-web). Needs ffmpeg on
// PATH and a Chromium for @playwright/test (CHROMIUM=/path/to/chrome overrides the bundled one).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(ROOT, 'apps/leclap-web/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://localhost:5393';
const OUT = path.join(ROOT, 'build/pr/webmcp/assets/videos/webmcp');
const VIEWPORT = { width: 1280, height: 720 };
// Captured at 2x device pixels and written at 1.5x (1920x1080): supersampled UI text.
const DPR = 2;
const FPS = 30;

// The on-screen layer: a pill naming each tool call and its outcome, and a pointer for the user's clicks.
// Injected as page chrome, never part of the builder.
function installOverlay() {
  const css = `
    #wm-call{position:fixed;right:22px;bottom:18px;z-index:2147483647;max-width:760px;padding:10px 16px;
      border-radius:14px;background:rgba(16,16,24,.92);border:1.5px solid #7C83FD;color:#F5F3F7;
      font:600 17px/1.35 'Roboto Mono',ui-monospace,monospace;box-shadow:0 10px 30px rgba(0,0,0,.45);
      opacity:0;transform:translateY(10px);transition:opacity .25s,transform .25s;pointer-events:none}
    #wm-call.on{opacity:1;transform:none}
    #wm-call.left{right:auto;left:22px}
    #wm-call small{display:block;font:500 12px/1.4 'Roboto Mono',monospace;letter-spacing:.08em;
      text-transform:uppercase;color:#9A9AB0;margin-bottom:3px}
    #wm-call .r{display:block;margin-top:4px;color:#7EE0B5;font-weight:500;font-size:15px}
    #wm-call .r.no{color:#FF8AAE}
    #wm-ptr{position:fixed;left:640px;top:420px;z-index:2147483647;width:26px;height:26px;opacity:0;
      pointer-events:none;transition:left .55s cubic-bezier(.3,.7,.2,1),top .55s cubic-bezier(.3,.7,.2,1),opacity .2s}
    #wm-ptr.on{opacity:1}
    #wm-ptr::after{content:'';position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;
      border:2px solid #7C83FD;opacity:0;transform:scale(.4)}
    #wm-ptr.tap::after{animation:wm-tap .45s ease-out}
    @keyframes wm-tap{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(1.6)}}`;
  const arrow =
    '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7.5 19 2.6-7.6L21 10.8z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const mount = () => {
    const style = document.createElement('style');
    style.textContent = css;
    const call = document.createElement('div');
    call.id = 'wm-call';
    const ptr = document.createElement('div');
    ptr.id = 'wm-ptr';
    ptr.innerHTML = arrow;
    document.body.append(style, call, ptr);
  };
  window.addEventListener('DOMContentLoaded', mount);
  window.__wm = {
    say(who, text, result, bad) {
      const el = document.getElementById('wm-call');
      el.replaceChildren();
      const label = document.createElement('small');
      label.textContent = who;
      el.append(label, document.createTextNode(text));
      if (result) {
        const r = document.createElement('span');
        r.className = bad ? 'r no' : 'r';
        r.textContent = result;
        el.append(r);
      }
      // With the agent drawer open on the right, the pill moves left so the activity log stays visible.
      el.classList.toggle('left', Boolean(document.querySelector('[data-agent-drawer]')));
      el.classList.add('on');
    },
    hush() {
      document.getElementById('wm-call').classList.remove('on');
    },
    point(x, y, tap) {
      const ptr = document.getElementById('wm-ptr');
      ptr.classList.add('on');
      ptr.style.left = `${x}px`;
      ptr.style.top = `${y}px`;
      if (tap) {
        ptr.classList.remove('tap');
        void ptr.offsetWidth;
        ptr.classList.add('tap');
      }
    },
    hide() {
      document.getElementById('wm-ptr').classList.remove('on');
    },
  };
}

const wait = (page, ms) => page.waitForTimeout(ms);
const say = (page, who, text, result, bad) => page.evaluate((a) => window.__wm.say(...a), [who, text, result, bad]);

async function call(page, name, args = {}) {
  const raw = await page.evaluate(
    ([n, a]) => navigator.modelContextTesting.executeTool(n, a),
    [name, JSON.stringify(args)]
  );
  return JSON.parse(raw ?? '{}');
}

// Show the call, run it, then show its outcome under it.
async function agent(page, label, name, args, outcome) {
  await say(page, 'browser agent', label);
  await wait(page, 450);
  const result = await call(page, name, args);
  const text = outcome(result);
  await say(page, 'browser agent', label, text, result.isError);
  return result;
}

async function pointAt(page, locator, tap = false) {
  const box = await locator.boundingBox();
  await page.evaluate((a) => window.__wm.point(...a), [box.x + box.width / 2, box.y + box.height / 2, tap]);
  await wait(page, 650);
}

async function click(page, locator) {
  await pointAt(page, locator);
  await page.evaluate(() => {
    const p = document.getElementById('wm-ptr');
    window.__wm.point(parseFloat(p.style.left), parseFloat(p.style.top), true);
  });
  await locator.click();
}

// One take: screencast the page while `scenario` runs, then write a constant-rate MP4.
async function take(context, page, name, scenario) {
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (event) => {
    frames.push({ data: event.data, at: event.metadata?.timestamp ?? Date.now() / 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: 2560,
    maxHeight: 1440,
    everyNthFrame: 1,
  });
  const start = Date.now() / 1000;
  await scenario();
  const end = Date.now() / 1000;
  // Frames arrive behind the page (JPEG encoding); keep listening a moment, then drop what came after `end`.
  await page.waitForTimeout(1500);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  const kept = frames.filter((frame) => frame.at <= end);
  frames.length = 0;
  frames.push(...kept);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-cast-'));
  const lines = ['ffconcat version 1.0'];
  frames.forEach((frame, i) => {
    const file = path.join(dir, `f${String(i).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(frame.data, 'base64'));
    const from = i === 0 ? start : frame.at;
    const next = frames[i + 1]?.at ?? end;
    lines.push(`file '${file}'`, `duration ${Math.max(0.001, next - from).toFixed(4)}`);
  });
  lines.push(lines.at(-2));
  fs.writeFileSync(path.join(dir, 'list.ffconcat'), lines.join('\n'));
  const dest = path.join(OUT, `${name}.mp4`);
  const vf = `fps=${FPS},scale=1920:1080:flags=lanczos,format=yuv420p`;
  // A silent stereo track: the reel's crossfades mix every section's audio.
  const input = ['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.ffconcat')];
  const silence = ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];
  const video = ['-vf', vf, '-c:v', 'libx264', '-crf', '16', '-preset', 'medium'];
  const audio = ['-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-shortest', '-movflags', '+faststart'];
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...input, ...silence, ...video, ...audio, dest]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${name}.mp4  ${(end - start).toFixed(2)} s  (${frames.length} frames)`);
}

const short = (rev) => `${String(rev).slice(0, 8)}…`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const executablePath = process.env.CHROMIUM || undefined;
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR, colorScheme: 'dark' });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text().slice(0, 200)));
  await page.addInitScript(() => {
    window.__webMCPPolyfillOptions = { installTestingShim: true };
    localStorage.setItem('leclap-theme', 'dark');
    localStorage.removeItem('leclap.webmcp.v1');
  });
  await page.addInitScript(installOverlay);
  await page.goto(`${BASE}/studio/builder?webmcp=polyfill`);
  await page.getByRole('dialog').getByRole('button', { name: 'Start blank' }).click();
  await page.waitForFunction(() => navigator.modelContextTesting?.listTools().length > 10, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await wait(page, 1200);
  const pill = page.locator('[data-agent-pill]');
  const drawer = page.getByRole('dialog', { name: 'Browser agent' });
  const confirm = page.getByRole('dialog', { name: 'Allow this browser agent action?' });
  let revision;

  await take(context, page, '01-agent', async () => {
    await wait(page, 500);
    await pointAt(page, pill);
    const count = await page.evaluate(() => navigator.modelContextTesting.listTools().length);
    await say(page, 'browser agent', 'navigator.modelContext · tools', `${count} tools registered by the builder`);
    await wait(page, 1600);
    await page.evaluate(() => window.__wm.hide());
    const got = await agent(page, 'get_template()', 'get_template', {}, (r) => {
      return `revision ${short(r.structuredContent.revision)} · read only`;
    });
    revision = got.structuredContent.revision;
    await wait(page, 1500);
    await agent(page, 'list_sections()', 'list_sections', {}, (r) => {
      const n = r.structuredContent.sections.length;
      return `${n} scene${n === 1 ? '' : 's'} · positions, timing, texts`;
    });
    await wait(page, 1500);
  });

  await take(context, page, '02-edit', async () => {
    await wait(page, 300);
    const themed = await agent(
      page,
      "set_theme({ expectedRevision, theme: 'midnight' })",
      'set_theme',
      { expectedRevision: revision, theme: 'midnight', note: 'Darker look' },
      () => 'applied · one undo step'
    );
    revision = themed.structuredContent.revision;
    await wait(page, 1700);
    const added = await agent(
      page,
      "add_section({ type: 'color_background', position: 0 })",
      'add_section',
      {
        expectedRevision: revision,
        type: 'color_background',
        position: 0,
        note: 'Opening title card',
        section: {
          options: { duration: 3, backgroundColor: '#101820' },
          titleCard: { headline: { en: 'Hello WebMCP' } },
        },
      },
      () => 'scene added · the new card glows'
    );
    revision = added.structuredContent.revision;
    await wait(page, 2400);
    await agent(
      page,
      "set_format({ expectedRevision, orientation: 'portrait' })",
      'set_format',
      { expectedRevision: revision, orientation: 'portrait', note: 'Try a vertical cut' },
      () => 'applied · 9:16'
    );
    await wait(page, 2000);
    await say(page, 'you', 'Ctrl+Z', 'the agent step undoes like your own edit');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    await wait(page, 2200);
  });

  await take(context, page, '03-review', async () => {
    await wait(page, 300);
    await agent(page, 'validate_template()', 'validate_template', {}, (r) => {
      const s = r.structuredContent;
      const errors = s.errors?.length ?? 0;
      return `valid: ${s.valid} · ${errors} error${errors === 1 ? '' : 's'} · geometry checked`;
    });
    await wait(page, 1800);
    await page.evaluate(() => window.__wm.hush());
    await click(page, pill);
    await drawer.waitFor();
    await wait(page, 1300);
    const undo = drawer.getByRole('button', { name: /undo/i }).first();
    if (await undo.isVisible()) await pointAt(page, undo);
    await say(page, 'drawer', 'Recent activity', 'each edit that is still current has Undo');
    await wait(page, 2200);
  });

  let render;
  await take(context, page, '04-confirm', async () => {
    await page.evaluate(() => window.__wm.hide());
    const samples = (await call(page, 'list_samples')).structuredContent.samples;
    const sample = samples.find((s) => s.openable);
    await say(page, 'browser agent', `load_sample({ id: '${sample.id}' })`);
    await wait(page, 400);
    const pending = call(page, 'load_sample', { id: sample.id, note: 'Start from a proven sample' });
    await confirm.waitFor();
    await wait(page, 1900);
    await click(page, confirm.getByRole('button', { name: "Don't allow" }));
    const declined = await pending;
    await say(
      page,
      'browser agent',
      `load_sample({ id: '${sample.id}' })`,
      `→ ${declined.structuredContent.code}`,
      true
    );
    await wait(page, 1900);
    await page.evaluate(() => window.__wm.hide());
    await say(page, 'browser agent', 'render_preview()');
    await wait(page, 400);
    render = call(page, 'render_preview', { note: 'Check the pacing' });
    await confirm.waitFor();
    await wait(page, 1900);
    await click(page, confirm.getByRole('button', { name: 'Allow', exact: true }));
    await wait(page, 300);
    await page.evaluate(() => window.__wm.hide());
    await say(page, 'browser agent', 'render_preview()', 'allowed · rendering in the page (WASM)');
    await wait(page, 1800);
  });

  const outcome = await render;
  console.log('render_preview:', JSON.stringify(outcome.structuredContent ?? outcome).slice(0, 300));
  await wait(page, 600);

  await take(context, page, '05-preview', async () => {
    const s = outcome.structuredContent ?? {};
    const secs = s.durationSeconds ?? s.duration;
    const detail = secs ? `ok · ${Number(secs).toFixed(1)} s preview with placeholder clips` : 'ok · preview ready';
    await say(page, 'browser agent', 'render_preview()', detail, outcome.isError);
    await wait(page, 1000);
    await pointAt(page, page.getByRole('dialog', { name: 'Preview render' }).locator('video').first());
    await wait(page, 2400);
  });

  // The preview the page rendered with ffmpeg.wasm, saved from its object URL. The reel plays it, since
  // a Chromium without proprietary codecs cannot play H.264 in the dialog.
  const preview = await page.evaluate(async () => {
    const video = document.querySelector('[role="dialog"] video');
    const bytes = new Uint8Array(await (await fetch(video.currentSrc || video.src)).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  fs.writeFileSync(path.join(OUT, 'preview-render.mp4'), Buffer.from(preview, 'base64'));
  console.log('preview-render.mp4 saved');

  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__wm.hush());
  await wait(page, 800);

  await take(context, page, '06-off', async () => {
    await wait(page, 300);
    if (!(await drawer.isVisible())) await click(page, pill);
    await drawer.waitFor();
    await wait(page, 1200);
    const toggle = drawer.getByRole('switch', { name: 'Let browser agents use this builder' });
    await click(page, toggle);
    await wait(page, 400);
    const left = await page.evaluate(() => navigator.modelContextTesting.listTools().length);
    await say(page, 'you', 'Let browser agents use this builder: off', `toolchange · ${left} tools registered`);
    await wait(page, 2000);
    await click(page, drawer.getByRole('button', { name: 'Close' }));
    await wait(page, 600);
    await pointAt(page, pill);
    await wait(page, 1600);
  });

  await browser.close();
}

await main();
