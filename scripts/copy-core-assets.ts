import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const libDir = resolve(root, 'packages/leclap-creative-kit/src/library');

// Plain ANSI, no dependency — and dropped entirely when the output isn't a TTY (CI logs, pipes).
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, text: string): string => (color ? `[${code}m${text}[0m` : text);
const bold = (text: string): string => paint(1, text);
const dim = (text: string): string => paint(2, text);
const green = (text: string): string => paint(32, text);
const yellow = (text: string): string => paint(33, text);

type CopyDest = { src: string; dest: string; include?: string[] };

function thumbFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => /\.(png|webp)$/.test(file))
    .sort();
}

function pngFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.png'))
    .sort();
}

const destinations: CopyDest[] = [
  {
    src: resolve(libDir, 'musics'),
    dest: resolve(root, 'apps/leclap-web/public/musics'),
  },
  {
    src: resolve(libDir, 'musics'),
    dest: resolve(root, 'apps/leclap-expo/assets/musics'),
  },
  {
    src: resolve(libDir, 'backgrounds'),
    dest: resolve(root, 'apps/leclap-web/public/backgrounds'),
  },
  {
    src: resolve(libDir, 'backgrounds'),
    dest: resolve(root, 'apps/leclap-expo/assets/backgrounds'),
  },
  {
    // Served at /assets/backgrounds/<file> — the canonical path bundled templates reference for an
    // image_background, so it resolves identically on web and on-device (expo maps the /assets/ marker).
    src: resolve(libDir, 'backgrounds'),
    dest: resolve(root, 'apps/leclap-web/public/assets/backgrounds'),
  },
  {
    src: resolve(libDir, 'fonts'),
    dest: resolve(root, 'apps/leclap-web/public/fonts'),
  },
  {
    src: resolve(libDir, 'fonts'),
    dest: resolve(root, 'apps/leclap-expo/assets/fonts'),
  },
  {
    src: resolve(libDir, 'animations'),
    dest: resolve(root, 'apps/leclap-web/public/assets/animations'),
  },
  {
    src: resolve(libDir, 'animations'),
    dest: resolve(root, 'apps/leclap-expo/assets/animations'),
  },
  {
    src: resolve(libDir, 'musics'),
    dest: resolve(root, 'apps/leclap-web/public/assets/musics'),
  },
  {
    // The sound-effect library (plain blobs, a few KB each), served at /assets/sfx/<file> for the builder's
    // sound-effects preview.
    src: resolve(libDir, 'sfx'),
    dest: resolve(root, 'apps/leclap-web/public/assets/sfx'),
  },
  {
    // Music cover art (<track id>.webp), served at /assets/covers/<file> for the music picker.
    src: resolve(libDir, 'covers'),
    dest: resolve(root, 'apps/leclap-web/public/assets/covers'),
  },
  {
    src: resolve(libDir, 'covers'),
    dest: resolve(root, 'apps/leclap-expo/assets/covers'),
  },
  {
    // The builder picker's engine-rendered animation thumbnails (animated WebP + PNG poster per entry),
    // served at /assets/animation-thumbs/<file>; the manifest below lists them for the picker.
    src: resolve(libDir, 'animation-thumbs'),
    dest: resolve(root, 'apps/leclap-web/public/assets/animation-thumbs'),
    include: thumbFiles(resolve(libDir, 'animation-thumbs')),
  },
  {
    // The RN picker shows the still posters only (no animated WebP decoding needed on device).
    src: resolve(libDir, 'animation-thumbs'),
    dest: resolve(root, 'apps/leclap-expo/assets/animation-thumbs'),
    include: pngFiles(resolve(libDir, 'animation-thumbs')),
  },
  {
    // Colour emoji the engine composites over drawn text: served at /assets/emoji/<file>, where the
    // browser filesystem adapter (and, on device, FilesystemExpoAdapter) resolves them for staging.
    src: resolve(libDir, 'emoji'),
    dest: resolve(root, 'apps/leclap-web/public/assets/emoji'),
    include: pngFiles(resolve(libDir, 'emoji')),
  },
  {
    src: resolve(libDir, 'emoji'),
    dest: resolve(root, 'apps/leclap-expo/assets/emoji'),
    include: pngFiles(resolve(libDir, 'emoji')),
  },
  {
    src: resolve(libDir, 'pictures'),
    dest: resolve(root, 'apps/leclap-web/public/assets/pictures'),
  },
  {
    src: resolve(libDir, 'videos'),
    dest: resolve(root, 'apps/leclap-web/public/assets/videos'),
  },
  {
    // The RN app only needs the brand bumpers bundled (the descriptor-referenced videos); the rest
    // are sample clips that would bloat the binary. Web ships the full set above.
    src: resolve(libDir, 'videos'),
    dest: resolve(root, 'apps/leclap-expo/assets/videos'),
    include: ['leclap_bumper.mp4', 'leclap_bumper_portrait.mp4'],
  },
];

console.log(`\n${bold('Staging creative-kit assets')}`);

let total = 0;

for (const { src, dest, include } of destinations) {
  mkdirSync(dest, { recursive: true });
  const files = include ?? readdirSync(src);

  for (const file of files) {
    cpSync(resolve(src, file), resolve(dest, file));
  }

  total += files.length;

  const count = String(files.length).padStart(3);
  console.log(`  ${green('✓')} ${basename(src).padEnd(11)} ${dim(count)} ${dim('→')} ${dim(relative(root, dest))}`);
}

console.log(`\n${green('✓')} ${bold(`${total} files`)} staged across ${destinations.length} targets\n`);

// The engine's HTML layer page, which the phone's hidden WebView draws HTML layers with. It is built with the
// engine (tsdown), so a checkout that hasn't built it yet gets a warning rather than a failure here.
const rasterPage = resolve(root, 'packages/ffmpeg-video-composer/dist/html-rasteriser.html');
const rasterPageDir = resolve(root, 'apps/leclap-expo/assets/html-rasteriser');

if (existsSync(rasterPage)) {
  mkdirSync(rasterPageDir, { recursive: true });
  cpSync(rasterPage, resolve(rasterPageDir, 'html-rasteriser.html'));
  console.log(`${green('✓')} ${dim(`html layer page → ${relative(root, rasterPageDir)}`)}\n`);
}

if (!existsSync(rasterPage)) {
  console.log(
    `${yellow('!')} ${dim('html layer page not built: run pnpm --filter ffmpeg-video-composer build before bundling the app')}\n`
  );
}

// Emit the animation manifest the web reads (a static, HMR-friendly list — more reliable than a
// cross-package import.meta.glob, which the dev server doesn't re-scan when files land in the library).
const animationFiles = readdirSync(resolve(libDir, 'animations'))
  .filter((file) => /\.(apng|webp|gif|webm)$/i.test(file))
  .sort();

const manifestPath = resolve(root, 'apps/leclap-web/src/data/animations.generated.ts');
// Emitted in the repo's own formatting (single quotes, trailing comma) rather than via
// JSON.stringify: the formatter rewrites double-quoted output on every commit, so a raw JSON dump
// would leave this file permanently dirty after each dev run and clean again after each commit.
const animationEntries = animationFiles.map((file) => `  '${file}',`).join('\n');

// The picker thumbnails (packages/leclap-creative-kit/scripts/gen-animation-thumbs.ts): one row per entry,
// keyed by kind and id, with the served URLs of its looping thumb and still poster.
interface ThumbEntry {
  id: string;
  label: string;
  thumb: string;
  poster: string;
  kind: string;
}

const thumbs = JSON.parse(readFileSync(resolve(libDir, 'animation-thumbs/manifest.json'), 'utf8')) as ThumbEntry[];
const thumbEntries = thumbs
  .map((entry) =>
    [
      '  {',
      `    id: '${entry.id}',`,
      `    label: '${entry.label.replace(/'/g, "\\'")}',`,
      `    kind: '${entry.kind}',`,
      `    thumb: '/assets/animation-thumbs/${entry.thumb}',`,
      `    poster: '/assets/animation-thumbs/${entry.poster}',`,
      '  },',
    ].join('\n')
  )
  .join('\n');
const manifest = `// AUTO-GENERATED by scripts/copy-core-assets.ts — do not edit.
// Every animation overlay in the creative-kit library, served from /public/assets/animations. Re-run
// the copy step (it runs on web build/start) after adding a file to the library to refresh this list.
export const ANIMATION_FILES: string[] = [
${animationEntries}
];

export interface AnimationThumb {
  id: string;
  /** English fallback label (the picker shows the i18n label \`animation.library.<id>\`). */
  label: string;
  kind: 'fx' | 'graphic' | 'sample';
  /** Looping preview (an animated WebP for engine entries, the poster for samples). */
  thumb: string;
  /** Still frame at the effect's peak (prefers-reduced-motion, and while the thumb loads). */
  poster: string;
}

// Engine-rendered picker thumbnails, served from /public/assets/animation-thumbs.
export const ANIMATION_THUMBS: AnimationThumb[] = [
${thumbEntries}
];
`;
writeFileSync(manifestPath, manifest);
console.log(`${green('✓')} ${dim(`animation manifest (${animationFiles.length}) → ${relative(root, manifestPath)}`)}`);

// Expo needs STATIC require()s (Metro can't build a path from a variable), so emit a literal require
// map of the same files. Bundled for on-device staging + the picker thumbnails.
const expoAssetsPath = resolve(root, 'apps/leclap-expo/src/data/animation-assets.generated.ts');
const expoEntries = animationFiles.map((file) => `  '${file}': require('../../assets/animations/${file}'),`).join('\n');
const expoAssets = `// AUTO-GENERATED by scripts/copy-core-assets.ts — do not edit.
// Bundled animation overlays for the RN app, keyed by filename → Metro asset id. Re-run the copy step
// (it runs on expo start) after adding a file to the library to refresh this map.
export const ANIMATION_ASSETS: Record<string, number> = {
${expoEntries}
};
`;
writeFileSync(expoAssetsPath, expoAssets);
console.log(
  `${green('✓')} ${dim(`expo animation assets (${animationFiles.length}) → ${relative(root, expoAssetsPath)}`)}\n`
);

// The picker posters get the same treatment: a static require map keyed by entry (`<kind>:<id>`).
const expoThumbsPath = resolve(root, 'apps/leclap-expo/src/data/animation-thumbs.generated.ts');
const expoThumbEntries = thumbs
  .map((entry) => `  '${entry.kind}:${entry.id}': require('../../assets/animation-thumbs/${entry.poster}'),`)
  .join('\n');
const expoThumbs = `// AUTO-GENERATED by scripts/copy-core-assets.ts — do not edit.
// Still posters of the animation library's entries for the RN picker, keyed by \`<kind>:<id>\` → Metro asset id.
// Re-run the copy step (it runs on expo start) after regenerating them (pnpm gen:animation-thumbs).
export const ANIMATION_THUMB_POSTERS: Record<string, number> = {
${expoThumbEntries}
};
`;
writeFileSync(expoThumbsPath, expoThumbs);
console.log(`${green('✓')} ${dim(`expo animation posters (${thumbs.length}) → ${relative(root, expoThumbsPath)}`)}\n`);

// The emoji images get the same static require map: CoreCompilationService stages them under
// `assetsDir/emoji`, where the engine's emoji staging finds them as `/assets/emoji/<file>`.
const emojiFiles = pngFiles(resolve(libDir, 'emoji'));
const expoEmojiPath = resolve(root, 'apps/leclap-expo/src/data/emoji-assets.generated.ts');
const emojiEntries = emojiFiles.map((file) => `  '${file}': require('../../assets/emoji/${file}'),`).join('\n');
const expoEmoji = `// AUTO-GENERATED by scripts/copy-core-assets.ts — do not edit.
// Bundled colour emoji (Twemoji, CC-BY 4.0) for on-device text lowering, keyed by filename → Metro asset id.
// Re-run the copy step (it runs on expo start) after regenerating the library (pnpm gen:emoji).
export const EMOJI_ASSETS: Record<string, number> = {
${emojiEntries}
};
`;
writeFileSync(expoEmojiPath, expoEmoji);
console.log(`${green('✓')} ${dim(`expo emoji assets (${emojiFiles.length}) → ${relative(root, expoEmojiPath)}`)}\n`);
