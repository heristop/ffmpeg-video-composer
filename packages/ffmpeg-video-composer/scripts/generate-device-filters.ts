import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeviceFilters, readDeviceLibraries } from './capability-sources';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, '../src/editor/utils/device-filters.generated.ts');
const filters = [...readDeviceFilters()].sort();
const libraries = [...readDeviceLibraries()].sort();

const body = [
  '// GENERATED from scripts/ffmpeg/common.sh — do not edit.',
  '// Regenerate with `pnpm --filter ffmpeg-video-composer generate:capabilities`.',
  '// Freshness is guarded by tests/lgpl-filter-audit.test.ts.',
  '',
  'export const DEVICE_FILTERS: ReadonlySet<string> = new Set([',
  ...filters.map((f) => `  '${f}',`),
  ']);',
  '',
  '/** External libraries the device build links (`--enable-lib<name>`): fribidi = drawtext text_shaping. */',
  'export const DEVICE_LIBRARIES: ReadonlySet<string> = new Set([',
  ...libraries.map((l) => `  '${l}',`),
  ']);',
  '',
].join('\n');

fs.writeFileSync(outPath, body);
console.log(`wrote ${outPath}`);
