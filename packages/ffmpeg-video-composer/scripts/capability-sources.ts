import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_EMITTED_FILTERS, FILTER_COMPAT, type EngineCapabilities } from '../src/editor/utils/filter-compat';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const commonShPath = path.resolve(repoRoot, 'scripts/ffmpeg/common.sh');

/** Parses the device build's multi-line `--enable-filter=` value out of common.sh. */
export function parseEnabledFilters(source: string): Set<string> {
  const match = /--enable-filter=([^ ]+(?:\\\n[^ ]+)*)/.exec(source);

  if (!match) {
    throw new Error('common.sh: --enable-filter list not found');
  }

  const joined = match[1].replace(/\\\n/g, '');

  return new Set(
    joined
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
  );
}

export function readDeviceFilters(): Set<string> {
  return parseEnabledFilters(fs.readFileSync(commonShPath, 'utf8'));
}

/** The external libraries the device build links (`--enable-libfribidi` → `fribidi`), from common.sh. */
export function parseEnabledLibraries(source: string): Set<string> {
  return new Set([...source.matchAll(/--enable-lib([a-z0-9_]+)/g)].map((match) => match[1]));
}

export function readDeviceLibraries(): Set<string> {
  return parseEnabledLibraries(fs.readFileSync(commonShPath, 'utf8'));
}

/** Compat rules keyed by the filter type their remap consumes (derived by probing each rule). */
function compatRuleFor(filterType: string): string | null {
  // deviceFilters: null here is deliberate — this "via compat" column reflects REWRITE rules only
  // (e.g. eq→lutyuv); null (full-build semantics) keeps the drop-absent-on-device rule from
  // matching during probing, which would otherwise mislabel every device gap as "via compat".
  const lgplCaps: EngineCapabilities = {
    gpl: false,
    lut3d: true,
    colorkey: true,
    textShaping: false,
    deviceFilters: null,
    missingFilters: null,
  };

  for (const rule of FILTER_COMPAT) {
    if (rule.match({ type: filterType, value: 'contrast=1' }, lgplCaps)) {
      return rule.key;
    }
  }

  return null;
}

/**
 * Renders docs/runtime-capabilities.md: one row per filter the engine can emit, with availability
 * per runtime. Node and browser-WASM use full FFmpeg builds (every listed filter present); the
 * on-device column is the curated LGPL --enable-filter list from scripts/ffmpeg/common.sh.
 */
export function renderCapabilityMatrix(): string {
  const device = readDeviceFilters();
  const filters = [...ENGINE_EMITTED_FILTERS].sort();

  const rows = filters.map((filter) => {
    const onDevice = device.has(filter);
    const compat = compatRuleFor(filter);

    let deviceCell = 'NO — gap';

    if (onDevice) {
      deviceCell = 'yes';
    }

    if (compat && !onDevice) {
      deviceCell = `via compat: ${compat}`;
    }

    return {
      filter: `\`${filter}\``,
      node: 'yes',
      browser: 'yes',
      device: deviceCell,
    };
  });

  // Column widths track the widest cell so long compat keys can't overflow the fixed padding and
  // fight prettier over the generated doc (which would deadlock the byte-exact freshness test).
  const colWidths = {
    filter: Math.max(6, ...rows.map((r) => r.filter.length)),
    node: Math.max('node (full build)'.length, ...rows.map((r) => r.node.length)),
    browser: Math.max('browser wasm (full build)'.length, ...rows.map((r) => r.browser.length)),
    device: Math.max('on-device (lgpl allowlist)'.length, ...rows.map((r) => r.device.length)),
  };

  // Build header and separator
  const header = `| ${`filter`.padEnd(colWidths.filter)} | ${'node (full build)'.padEnd(colWidths.node)} | ${'browser wasm (full build)'.padEnd(colWidths.browser)} | ${'on-device (lgpl allowlist)'.padEnd(colWidths.device)} |`;
  const separator = `| ${'-'.repeat(colWidths.filter)} | ${'-'.repeat(colWidths.node)} | ${'-'.repeat(colWidths.browser)} | ${'-'.repeat(colWidths.device)} |`;

  // Build data rows
  const dataRows = rows.map(
    (r) =>
      `| ${r.filter.padEnd(colWidths.filter)} | ${r.node.padEnd(colWidths.node)} | ${r.browser.padEnd(colWidths.browser)} | ${r.device.padEnd(colWidths.device)} |`
  );

  return [
    '# Runtime filter capabilities',
    '',
    '> GENERATED — do not edit. Regenerate with `pnpm --filter ffmpeg-video-composer generate:capabilities`.',
    '> Sources: `ENGINE_EMITTED_FILTERS` + `FILTER_COMPAT` (engine) and the `--enable-filter` list in `scripts/ffmpeg/common.sh` (device build).',
    '> Guarded by `tests/capability-matrix.test.ts` (freshness) and `tests/lgpl-filter-audit.test.ts` (no uncovered emission).',
    '',
    header,
    separator,
    ...dataRows,
    '',
    `Device allowlist size: ${device.size} filters. The on-device engine binary must be rebuilt (\`scripts/ffmpeg/build-engine.sh\`) whenever the allowlist changes; until then, older installed engines lack newly added filters and affected renders can fail. Expo compilation stays local; there is no server fallback.`,
    '',
  ].join('\n');
}
