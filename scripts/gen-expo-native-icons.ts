// Refresh the Expo app's **prebuilt native** icon + splash bitmaps (ios/ and android/, both
// gitignored) — without a full `expo prebuild`, which would risk the hand-maintained on-device
// FFmpeg engine wiring. Two sources: the full-bleed gradient (icon-source.svg) for the home-screen
// launcher icons (iOS/Android need opaque, full-bleed), and the transparent disc (favicon.svg) for
// the splash logos. PNGs via resvg; Android mipmap .webp via ffmpeg (libwebp).
// Run: `pnpm gen:icons:native` (re-run after a prebuild, which would overwrite these).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expo = resolve(root, 'apps/leclap-expo');
const disc = readFileSync(resolve(root, 'apps/leclap-web/public/favicon.svg'), 'utf8');
const launcher = readFileSync(resolve(expo, 'assets/icon-source.svg'), 'utf8');
// Separate Android layers preserve launcher masking, motion, and themed tinting.
const adaptive = readFileSync(resolve(expo, 'assets/adaptive-foreground.svg'), 'utf8');
const adaptiveBackground = readFileSync(resolve(expo, 'assets/adaptive-background.svg'), 'utf8');
const adaptiveMonochrome = readFileSync(resolve(expo, 'assets/adaptive-monochrome.svg'), 'utf8');

if (!existsSync(resolve(expo, 'ios')) && !existsSync(resolve(expo, 'android'))) {
  console.log('No prebuilt ios/android dirs — nothing to refresh (managed workflow).');
  process.exit(0);
}

// Cache one render per (source, size).
const cache = new Map<string, Buffer>();
const png = (svg: string, size: number): Buffer => {
  const key = `${size}:${svg}`;
  const cached = cache.get(key);

  if (cached) return cached;
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  cache.set(key, rendered);

  return rendered;
};

// Android density → scale factor for the three launcher layers.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// [size (px), output path (relative to the expo app), source svg]
const pngTargets: [number, string, string][] = [
  [1024, 'ios/LeClap/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png', launcher],
  [150, 'ios/LeClap/Images.xcassets/SplashScreenLogo.imageset/image.png', disc],
  [300, 'ios/LeClap/Images.xcassets/SplashScreenLogo.imageset/image@2x.png', disc],
  [450, 'ios/LeClap/Images.xcassets/SplashScreenLogo.imageset/image@3x.png', disc],
  ...Object.entries(DENSITIES).map(([d, s]): [number, string, string] => [
    Math.round(288 * s),
    `android/app/src/main/res/drawable-${d}/splashscreen_logo.png`,
    disc,
  ]),
];

const webpTargets: [number, string, string][] = Object.entries(DENSITIES).flatMap(
  ([d, s]): [number, string, string][] => [
    [Math.round(48 * s), `android/app/src/main/res/mipmap-${d}/ic_launcher.webp`, launcher],
    [Math.round(48 * s), `android/app/src/main/res/mipmap-${d}/ic_launcher_round.webp`, launcher],
    [Math.round(108 * s), `android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.webp`, adaptive],
    [Math.round(108 * s), `android/app/src/main/res/mipmap-${d}/ic_launcher_background.webp`, adaptiveBackground],
    [Math.round(108 * s), `android/app/src/main/res/mipmap-${d}/ic_launcher_monochrome.webp`, adaptiveMonochrome],
  ]
);

for (const [size, rel, svg] of pngTargets) {
  const out = resolve(expo, rel);

  if (!existsSync(dirname(out))) continue;
  writeFileSync(out, png(svg, size));
  console.log(`${String(size).padStart(4)}px  ${rel}`);
}

for (const [size, rel, svg] of webpTargets) {
  const out = resolve(expo, rel);

  if (!existsSync(dirname(out))) continue;
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', 'pipe:0', '-c:v', 'libwebp', '-lossless', '1', '-frames:v', '1', out],
    { input: png(svg, size) }
  );
  console.log(`${String(size).padStart(4)}px  ${rel}`);
}

// Keep existing prebuilt resources aligned with Expo's adaptiveIcon configuration.
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@mipmap/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;

for (const name of ['ic_launcher', 'ic_launcher_round']) {
  const out = resolve(expo, `android/app/src/main/res/mipmap-anydpi-v26/${name}.xml`);

  if (existsSync(out)) writeFileSync(out, adaptiveXml);
}

console.log(`\nRefreshed ${pngTargets.length} PNG + ${webpTargets.length} webp native icons`);
