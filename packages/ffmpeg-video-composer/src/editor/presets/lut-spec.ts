// The `lut3d` filter value the look/grade lowering emits, and the build-FS file it stages to. Three forms:
//   "<lut>"                 a generated preset LUT at full strength (the historical value, unchanged)
//   "<lut>@<strength>"      the same preset blended toward identity (0..1)
//   "url:<url>@<strength>"  a user .cube (Log conversion, a colourist's grade), parsed and re-blended
// The FormatterManager rewrites the value to `lut3d=file='<lutsDir>/<stem>.cube'` and the AssetManager
// stages that file, so the grade stays ONE lut3d on every backend.

import { quantizeStrength } from '@/core/footage/lut-cube';
import { sha256Hex } from '@/core/determinism/sha256';

export type LutSpec =
  | { kind: 'preset'; name: string; strength: number }
  | { kind: 'url'; url: string; strength: number };

const URL_PREFIX = 'url:';

/** Filter value for a generated preset LUT; full strength keeps the bare historical name. */
export function presetLutValue(name: string, strength?: number): string {
  const amount = quantizeStrength(strength);

  return amount === 1 ? name : `${name}@${amount}`;
}

/** Filter value for a user-supplied `.cube`. */
export function urlLutValue(url: string, strength?: number): string {
  return `${URL_PREFIX}${url}@${quantizeStrength(strength)}`;
}

// Splits "<head>@<strength>" on its LAST "@" (a URL may carry its own); no numeric suffix = strength 1.
function splitStrength(value: string): { head: string; strength: number } {
  const at = value.lastIndexOf('@');
  const strength = at < 0 ? Number.NaN : Number(value.slice(at + 1));

  if (at < 0 || !Number.isFinite(strength)) return { head: value, strength: 1 };

  return { head: value.slice(0, at), strength: quantizeStrength(strength) };
}

export function parseLutValue(value: string): LutSpec {
  const { head, strength } = splitStrength(value);

  if (head.startsWith(URL_PREFIX)) return { kind: 'url', url: head.slice(URL_PREFIX.length), strength };

  return { kind: 'preset', name: head, strength };
}

function strengthSuffix(strength: number): string {
  return `-s${String(Math.round(strength * 1000)).padStart(4, '0')}`;
}

/**
 * The staged file's stem (without `.cube`): the bare preset name at full strength (byte-identical
 * filtergraphs for every existing template), a strength suffix otherwise, and a URL digest for a user
 * cube so the path never carries characters from the URL.
 */
export function lutFileStem(value: string): string {
  const spec = parseLutValue(value);

  if (spec.kind === 'url') return `user-${sha256Hex(spec.url).slice(0, 16)}${strengthSuffix(spec.strength)}`;

  return spec.strength === 1 ? spec.name : `${spec.name}${strengthSuffix(spec.strength)}`;
}
