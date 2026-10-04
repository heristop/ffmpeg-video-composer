// Rasterize the LeClap mark into every PNG icon the apps need. Two sources:
//  - apps/leclap-web/public/favicon.svg          the disc (transparent corners) — web favicons,
//                                                the in-app logo, and the splash mark.
//  - apps/leclap-expo/assets/icon-source.svg     full-bleed gradient — the home-screen launcher
//                                                icons (iOS/Android need opaque, full-bleed).
// Run: `pnpm gen:icons`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const disc = readFileSync(resolve(root, 'apps/leclap-web/public/favicon.svg'), 'utf8');
const launcher = readFileSync(resolve(root, 'apps/leclap-expo/assets/icon-source.svg'), 'utf8');
// Separate Android layers preserve launcher masking, motion, and themed tinting.
const adaptive = readFileSync(resolve(root, 'apps/leclap-expo/assets/adaptive-foreground.svg'), 'utf8');
const adaptiveBackground = readFileSync(resolve(root, 'apps/leclap-expo/assets/adaptive-background.svg'), 'utf8');
const adaptiveMonochrome = readFileSync(resolve(root, 'apps/leclap-expo/assets/adaptive-monochrome.svg'), 'utf8');

// [size (px), output path relative to repo root, source svg]
const targets: [number, string, string][] = [
  // Expo launcher icons (home screen) → full-bleed gradient.
  [1024, 'apps/leclap-expo/assets/images/icon.png', launcher],
  [1024, 'apps/leclap-expo/assets/images/adaptive-icon.png', adaptive],
  [1024, 'apps/leclap-expo/assets/images/adaptive-background.png', adaptiveBackground],
  [1024, 'apps/leclap-expo/assets/images/adaptive-monochrome.png', adaptiveMonochrome],
  [1024, 'apps/leclap-expo/assets/icon.png', launcher],
  [1024, 'apps/leclap-expo/assets/adaptive-icon.png', adaptive],
  // Expo in-app logo + splash + web favicon → disc.
  [600, 'apps/leclap-expo/assets/images/logo.png', disc],
  [600, 'apps/leclap-expo/assets/images/splash-icon.png', disc],
  [48, 'apps/leclap-expo/assets/images/favicon.png', disc],
  [48, 'apps/leclap-expo/assets/favicon.png', disc],
  // Web.
  [32, 'apps/leclap-web/public/favicon-32x32.png', disc],
  [16, 'apps/leclap-web/public/favicon-16x16.png', disc],
  [180, 'apps/leclap-web/public/apple-touch-icon.png', disc],
  [192, 'apps/leclap-web/public/pwa-192x192.png', disc],
  [512, 'apps/leclap-web/public/pwa-512x512.png', disc],
  [512, 'apps/leclap-web/public/assets/pictures/logo.png', disc],
];

// Cache one render per (source, size) — several targets share dimensions.
const cache = new Map<string, Buffer>();
const renderAt = (svg: string, size: number): Buffer => {
  const key = `${size}:${svg}`;
  const cached = cache.get(key);

  if (cached) return cached;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  cache.set(key, png);

  return png;
};

for (const [size, rel, svg] of targets) {
  const out = resolve(root, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderAt(svg, size));
  console.log(`${String(size).padStart(4)}px  ${rel}`);
}

console.log(`\nWrote ${targets.length} icons (disc → web/splash, full-bleed → launcher)`);
