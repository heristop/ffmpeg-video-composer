#!/usr/bin/env node
// Render the builder picker's animation thumbnails (src/library/animation-thumbs/): every engine primitive
// of the animation library (src/editor/animation-library.ts), rendered by the engine itself on a fixed 16:9
// neutral card (#1A1D24 with a mid-grey rounded "subject" the masked effects live on), encoded as a looping
// animated WebP (320×180, 2 s, ≤ 60 KB) plus a still PNG poster at the effect's peak (shown under
// prefers-reduced-motion and while the WebP loads). The legacy APNG samples are Git LFS pointers in most
// checkouts, so their posters come from the committed showcase renders that used the real files.
// Writes manifest.json ({ id, label, thumb, poster, kind }); scripts/copy-core-assets.ts stages it for the apps.
//
// Run: pnpm --dir packages/leclap-creative-kit gen:animation-thumbs [--only sheen,glint] [--sheets <dir>]
// (--sheets also writes a 6-frame strip of each clip there, for review: the WebPs are not decodable by ffmpeg).
// Needs the engine build (pnpm --filter ffmpeg-video-composer build) and an ffmpeg with libwebp on PATH.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'ffmpeg-video-composer';
import {
  ENGINE_THUMBS,
  SAMPLE_THUMBS,
  STAGE_INPUTS,
  type EngineThumb,
  type ManifestEntry,
  type SampleThumb,
} from './animation-thumbs-data.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../src/library/animation-thumbs');
const showcaseDir = path.resolve(here, '../../../apps/leclap-web/public/videos/showcase');

const SIZE = { width: 320, height: 180 };
const SECONDS = 2;
const FPS = 15;
const MAX_THUMB_BYTES = 60 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;

function ffmpeg(args: string[]): void {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' });

  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${run.stderr}`);
}

function descriptor(thumb: EngineThumb) {
  return {
    meta: { name: `thumb-${thumb.id}`, description: 'Animation library thumbnail (gen-animation-thumbs).' },
    global: { orientation: 'landscape', musicEnabled: false, seed: 11, fps: 30, transition: { type: 'cut' } },
    sections: [
      {
        name: 'thumb',
        type: 'color_background',
        options: { backgroundColor: '#1A1D24', duration: SECONDS },
        inputs: STAGE_INPUTS,
        graphics: thumb.graphics,
      },
    ],
  };
}

const SCALE = `scale=${SIZE.width}:${SIZE.height}:flags=lanczos`;

// The picture filter of a thumb: the whole frame, or a half-size window of it for a zoomed one.
function view(zoom: EngineThumb['zoom']): string {
  return zoom ? `crop=iw/2:ih/2:${zoom.x}:${zoom.y},${SCALE}` : SCALE;
}

// Encode the clip at decreasing quality until it fits the per-thumb budget.
function encodeWebp(video: string, file: string, picture: string): void {
  for (const quality of [72, 62, 52, 42, 32]) {
    ffmpeg([
      '-i',
      video,
      '-vf',
      `fps=${FPS},${picture}`,
      '-an',
      '-c:v',
      'libwebp_anim',
      '-loop',
      '0',
      '-quality',
      `${quality}`,
      '-compression_level',
      '6',
      '-preset',
      'picture',
      file,
    ]);

    if (statSync(file).size <= MAX_THUMB_BYTES) return;
  }

  throw new Error(`${path.basename(file)} is over ${MAX_THUMB_BYTES} bytes at the lowest quality`);
}

function poster(video: string, at: number, file: string, picture = SCALE): void {
  ffmpeg(['-ss', `${at}`, '-i', video, '-frames:v', '1', '-vf', picture, file]);
}

async function renderEngineThumb(thumb: EngineThumb, work: string): Promise<ManifestEntry> {
  const buildDir = path.join(work, thumb.id);
  const errors: Error[] = [];
  const video = await compile({ buildDir, assetsDir: buildDir }, descriptor(thumb) as never, {
    onError: (error) => errors.push(error),
  });

  if (!video) throw new Error(`${thumb.id}: render failed: ${errors.at(0)?.message ?? 'unknown error'}`);

  const picture = view(thumb.zoom);

  encodeWebp(video, path.join(outDir, `${thumb.id}.webp`), picture);

  const sheets = flag('--sheets');

  if (sheets) {
    mkdirSync(sheets, { recursive: true });
    ffmpeg(['-i', video, '-vf', `fps=3,${picture},tile=6x1`, '-frames:v', '1', path.join(sheets, `${thumb.id}.png`)]);
  }

  poster(video, thumb.peak, path.join(outDir, `${thumb.id}.png`), picture);

  return { id: thumb.id, label: thumb.label, thumb: `${thumb.id}.webp`, poster: `${thumb.id}.png`, kind: thumb.kind };
}

// A legacy sample's still: one frame of the showcase render that used the real APNG.
function renderSampleThumb(sample: SampleThumb): ManifestEntry {
  const file = `sample-${sample.id}.png`;

  poster(path.join(showcaseDir, `${sample.showcase}.mp4`), sample.at, path.join(outDir, file));

  return { id: sample.id, label: sample.label, thumb: file, poster: file, kind: 'sample' };
}

function readManifest(): ManifestEntry[] {
  try {
    return JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8')) as ManifestEntry[];
  } catch {
    return [];
  }
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);

  return at === -1 ? undefined : process.argv[at + 1];
}

function onlyFilter(): ((id: string) => boolean) | null {
  const only = flag('--only');
  const ids = only === undefined ? null : only.split(',').filter(Boolean);

  return ids ? (id) => ids.includes(id) : null;
}

async function main(): Promise<void> {
  const only = onlyFilter();
  const keep = (entry: { id: string }) => only === null || only(entry.id);
  const work = mkdtempSync(path.join(tmpdir(), 'leclap-thumbs-'));
  const fresh: ManifestEntry[] = [];

  mkdirSync(outDir, { recursive: true });

  try {
    // One render at a time (each compile already uses every core), chained rather than awaited in a loop.
    await ENGINE_THUMBS.filter(keep).reduce(
      (previous, thumb) =>
        previous.then(async () => {
          fresh.push(await renderEngineThumb(thumb, work));
          process.stdout.write(`  ✓ ${thumb.id}\n`);
        }),
      Promise.resolve()
    );

    fresh.push(...SAMPLE_THUMBS.filter(keep).map(renderSampleThumb));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const order = [...ENGINE_THUMBS, ...SAMPLE_THUMBS].map((entry, index) => [entry.id, index] as const);
  const rank = new Map(order);
  const merged = new Map(readManifest().map((entry) => [`${entry.kind}:${entry.id}`, entry]));

  for (const entry of fresh) merged.set(`${entry.kind}:${entry.id}`, entry);

  const manifest = [...merged.values()].toSorted(
    (a, b) => Number(a.kind === 'sample') - Number(b.kind === 'sample') || (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
  );
  const files = new Set(manifest.flatMap((entry) => [entry.thumb, entry.poster]));
  const total = [...files].reduce((sum, file) => sum + statSync(path.join(outDir, file)).size, 0);

  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `✓ ${manifest.length} thumbnails, ${(total / 1024).toFixed(0)} KB → ${path.relative(process.cwd(), outDir)}\n`
  );

  if (total > MAX_TOTAL_BYTES) throw new Error(`thumbnails total ${total} bytes, over the ${MAX_TOTAL_BYTES} budget`);
}

await main();
