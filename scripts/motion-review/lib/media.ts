import { execFileSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { FORMATS, FRAME, type Format } from './types.ts';

// Media for review renders without Git LFS: every bundled asset that is still an LFS pointer is either
// replaced by a generated stand-in (footage, pictures) or reported as "pointer, not rendered" (APNG
// animations, which have no meaningful stand-in). The stage is a copy of the real assets plus the
// generated files, passed to the CLI as `--assets` (copies, not symlinks: the engine refuses to read a
// file whose real path is outside the staged directory).

const POINTER_HEAD = 'version https://git-lfs';
const VIDEO = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const PICTURE = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** Directory of generated stand-ins inside the stage, as the descriptors reference it. */
export const REVIEW_DIR = '__review';

export function ffmpegBinary(): string {
  return process.env.FFMPEG ?? 'ffmpeg';
}

/** True when the file is a Git LFS pointer (a ~130 byte text stub) instead of the real media. */
export function isLfsPointer(file: string): boolean {
  if (!existsSync(file) || statSync(file).size > 512) return false;

  const fd = openSync(file, 'r');
  const head = Buffer.alloc(POINTER_HEAD.length);

  readSync(fd, head, 0, head.length, 0);
  closeSync(fd);

  return head.toString('utf8') === POINTER_HEAD;
}

/** `/assets/animations/x.apng` → the file under the asset root (null for remote or non-asset URLs). */
export function assetFile(assetsRoot: string, url: string): string | null {
  if (!url.startsWith('/assets/')) return null;

  return path.join(assetsRoot, url.slice('/assets/'.length));
}

/** URL of the moving mid-grey footage stand-in for a format. */
export function footageUrl(format: Format): string {
  return `/assets/${REVIEW_DIR}/footage-${format}.mp4`;
}

function ffmpeg(args: string[]): void {
  execFileSync(ffmpegBinary(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

// A slowly turning two-tone ramp (dark slate to warm grey) with static luma grain: mid-tone "footage"
// that moves, has both shadows and highlights, and compresses to a few hundred KB.
function writeFootage(file: string, format: Format): void {
  const { width, height } = FRAME[format];
  const source =
    `gradients=s=${width}x${height}:r=30:d=16:c0=0x4a525e:c1=0xa59e92:nb_colors=2:` +
    `x0=0:y0=0:x1=${width}:y1=${height}:speed=0.004:seed=7,format=yuv420p,noise=c0s=5:c0f=u:all_seed=7`;

  ffmpeg(['-f', 'lavfi', '-i', source, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-an', file]);
}

function writePicture(file: string): void {
  const source = 'gradients=s=1280x720:c0=0x5a6270:c1=0xb3aa9c:nb_colors=2:x0=0:y0=0:x1=1280:y1=720:seed=3';

  ffmpeg(['-f', 'lavfi', '-i', source, '-frames:v', '1', file]);
}

function writeStandIns(dir: string): void {
  mkdirSync(dir, { recursive: true });

  for (const format of FORMATS) {
    const file = path.join(dir, `footage-${format}.mp4`);

    if (!existsSync(file)) writeFootage(file, format);
  }

  for (const ext of ['png', 'jpg']) {
    const file = path.join(dir, `picture.${ext}`);

    if (!existsSync(file)) writePicture(file);
  }
}

function standInFor(ext: string): string | null {
  if (VIDEO.has(ext)) return 'footage-landscape.mp4';

  if (PICTURE.has(ext)) return ext === '.png' ? 'picture.png' : 'picture.jpg';

  return null;
}

function stageFile(source: string, target: string, stage: string): void {
  if (existsSync(target)) return;

  const ext = path.extname(source).toLowerCase();

  const standIn = isLfsPointer(source) ? standInFor(ext) : null;

  if (!isLfsPointer(source)) copyFileSync(source, target);

  if (standIn) copyFileSync(path.join(stage, REVIEW_DIR, standIn), target);
}

function stageTree(source: string, target: string, stage: string): void {
  mkdirSync(target, { recursive: true });

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);

    if (entry.isDirectory()) stageTree(from, to, stage);

    if (entry.isFile()) stageFile(from, to, stage);
  }
}

/**
 * Build the review asset stage for `assetsRoot` in `<cacheDir>/assets`: real files are copied, pointer
 * footage and pictures become generated stand-ins (made once, kept in `__review/`), pointer animations
 * and music are left out.
 */
export function prepareStage(assetsRoot: string, cacheDir: string): string {
  const stage = path.join(cacheDir, 'assets');

  mkdirSync(stage, { recursive: true });

  for (const entry of readdirSync(stage)) {
    if (entry !== REVIEW_DIR) rmSync(path.join(stage, entry), { recursive: true, force: true });
  }

  writeStandIns(path.join(stage, REVIEW_DIR));
  stageTree(assetsRoot, stage, stage);

  return stage;
}
