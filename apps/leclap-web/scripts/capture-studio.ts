// Record real screen-capture VIDEO clips of the web app's video-creation flow (/studio → editor →
// render) for the Remotion promos (WebCreate, the showcase's desktop beat). Each beat is screencast in its
// own 2x context (scripts/screencast.ts — crisp, high-bitrate) into the brand-motion repo's public/captures
// dir, where the compositions embed them via <OffthreadVideo>/staticFile().
// They land in the private leclap-brand-motion repo (github.com/heristop/leclap-brand-motion):
// LECLAP_BRAND_MOTION points at its checkout, a sibling of this monorepo by default.
//
// Needs the dev server up:  pnpm --filter @leclap/web dev   (default :5174; override with E2E_BASE_URL)
// Needs ffmpeg on PATH. Run:  node apps/leclap-web/scripts/capture-studio.ts  [--only gallery,compose,trim,result]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { recordScreencast } from './screencast.ts';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
const here = path.dirname(fileURLToPath(import.meta.url));
const brandMotion = process.env.LECLAP_BRAND_MOTION ?? path.resolve(here, '../../../../leclap-brand-motion');
const outDir = path.join(brandMotion, 'public/captures');
const SIZE = { width: 1600, height: 900 };
// Portrait, so the selfie clip below fills the preview whole instead of a centre-cropped band.
const TEMPLATE = 'present-yourself';
const FORMAT = 'portrait';
// The same person the showcase's mobile beat follows (Alex, filming herself) — bright, and one story.
const SAMPLE = path.join(outDir, 'selfie-wave-source.mp4');

// Run an async step for each item in order (a lint-clean alternative to `await` inside a for-loop).
const forEachSeq = async <T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> => {
  await items.reduce<Promise<void>>((prev, item) => prev.then(() => fn(item)), Promise.resolve());
};

const editor = async (page: Page): Promise<void> => {
  await page.goto(`${BASE}/studio/new?template=${TEMPLATE}&format=${FORMAT}`);
  await page.getByPlaceholder(/enter your (first )?name/i).waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
};

// Fill the form + upload a clip; the preview fills with the footage.
const compose = async (page: Page): Promise<void> => {
  await editor(page);
  await page.getByPlaceholder(/enter your (first )?name/i).fill('Alex');
  await page.waitForTimeout(700);
  await page.getByText('Record your clip', { exact: false }).first().click();
  await page.waitForTimeout(900);
  await page.locator('input[type=file]').first().setInputFiles(SAMPLE);
  await page.waitForTimeout(3200);
};

// Press a timeline handle and drag it `dx` px along the clip bar.
const dragHandle = async (page: Page, name: string, dx: number): Promise<void> => {
  const box = await page.getByRole('slider', { name }).boundingBox();

  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 24 });
  await page.mouse.up();
};

// Trim the take: open Trim & crop, bring the clip bar into view, then drag both handles in to keep the best
// section — the bar shrinks and its length ticks down live.
const trim = async (page: Page): Promise<void> => {
  await compose(page);
  await page
    .getByText(/trim & crop/i)
    .first()
    .click();
  await page.waitForTimeout(700);
  await page.mouse.move(1000, 450);
  await forEachSeq([120, 120] as const, async (dy) => {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(220);
  });
  await page.waitForTimeout(400);
  await dragHandle(page, 'Trim start', 260);
  await page.waitForTimeout(250);
  await dragHandle(page, 'Trim end', -330);
  await page.waitForTimeout(1400);
};

// The studio gallery — slow scroll through the template cards.
const gallery = async (page: Page): Promise<void> => {
  await page.goto(`${BASE}/studio`);
  await page.getByText('Present Yourself', { exact: false }).first().waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  await forEachSeq([320, 320, -640] as const, async (dy) => {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(900);
  });
};

// The full create: compose, then "Create my video" → render → the finished clip plays.
const createFlow = async (page: Page): Promise<void> => {
  await compose(page);
  await page.getByRole('button', { name: /create my video/i }).click();
  // The result screen shows the rendered <video>; wait it out, then play a few seconds.
  await page.getByText(/create another video/i).waitFor({ state: 'visible', timeout: 7 * 60 * 1000 });
  await page.waitForTimeout(600);
  await page
    .locator('video')
    .first()
    .evaluate((v: HTMLVideoElement) => v.play())
    .catch(() => {});
  await page.waitForTimeout(4500);
};

const onlyArg = process.argv[process.argv.indexOf('--only') + 1];
const only = process.argv.includes('--only') && onlyArg ? new Set(onlyArg.split(',')) : null;
const wanted = (name: string): boolean => only === null || only.has(name);

const main = async (): Promise<void> => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    args: ['--disk-cache-dir=/tmp/leclap-pw-cache', '--disk-cache-size=104857600'],
  });

  const out = (name: string): string => path.join(outDir, `${name}.mp4`);

  // Each clip starts where its action does (the app paints a blank page first), so compositions can play
  // it from frame 0.
  if (wanted('gallery')) await recordScreencast(browser, SIZE, gallery, out('studio-gallery'), { startSeconds: 2.8 });

  if (wanted('compose')) await recordScreencast(browser, SIZE, compose, out('studio-compose'), { startSeconds: 5.9 });

  if (wanted('result')) await recordScreencast(browser, SIZE, createFlow, out('studio-result'), { tailSeconds: 5.5 });

  if (wanted('trim')) await recordScreencast(browser, SIZE, trim, out('studio-trim'), { startSeconds: 16.8 });

  await browser.close();
  process.stdout.write('done\n');
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
