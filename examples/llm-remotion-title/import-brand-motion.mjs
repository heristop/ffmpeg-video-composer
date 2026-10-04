import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit trusted local source snapshot: no dependency install, network or source-repo writes.
const example = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(process.argv[2] ?? '/Users/alexandre_mogere/Workspace/leclap-brand-motion');
const capture = path.resolve(process.argv[3] ?? path.join(source, 'public/captures/studio-gallery.mp4'));
const kit = path.join(example, 'remotion/brand-motion-kit');
await mkdir(path.join(kit, 'film'), { recursive: true });
await mkdir(path.join(example, 'media'), { recursive: true });
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
const manifest = { source, capture, files: {} };
await Promise.all(
  ['film/cinema.tsx', 'film/clappy.tsx', 'brand.ts'].map(async (relative) => {
    const bytes = await readFile(path.join(source, 'src', relative));
    await writeFile(path.join(kit, relative), bytes);
    manifest.files[`src/${relative}`] = sha256(bytes);
  })
);
const shim =
  "// Generated shim: exact supplied font loaded by WebAppPromo.\nexport const OSWALD = 'LeclapPromoFont';\n";
await writeFile(path.join(kit, 'fonts.ts'), shim);
manifest.files['generated/fonts.ts'] = sha256(shim);
await Promise.all(
  [
    ['Oswald.ttf', 'font.ttf'],
    ['logo.png', 'logo.png'],
  ].map(async ([original, target]) => {
    const bytes = await readFile(path.join(source, 'public', original));
    await copyFile(path.join(source, 'public', original), path.join(example, 'media', target));
    manifest.files[`public/${original}`] = sha256(bytes);
  })
);
manifest.files.capture = sha256(await readFile(capture));
const result = spawnSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    '1',
    '-i',
    capture,
    '-frames:v',
    '1',
    '-threads',
    '1',
    path.join(example, 'media/screenshot.png'),
  ],
  { stdio: 'inherit' }
);

if (result.error) throw result.error;

if (result.status !== 0) throw new Error(`Capture extraction failed: ${result.status}`);
manifest.files['generated/screenshot.png'] = sha256(await readFile(path.join(example, 'media/screenshot.png')));
await writeFile(path.join(kit, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Private kit staged. Use remotion/brand-motion-index.tsx and tsconfig.brand-motion.json.');
