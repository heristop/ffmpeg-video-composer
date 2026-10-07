// Portable hashing for the determinism contract. Everything here is pure TypeScript: no `node:crypto`,
// no WebCrypto (async, and absent on Hermes), so the browser, React Native and Node bundles all derive
// the same seeds and manifest digests from the same bytes.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over the UTF-8 bytes of `input`. Stable across platforms and runs. */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET;

  for (const byte of utf8(input)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return hash >>> 0;
}

/**
 * The per-element seed of a procedural effect: `hash32(globalSeed, elementPath)`. Two elements never
 * share a random stream, and re-ordering unrelated sections never perturbs an element's own stream,
 * because the path (e.g. `sections.intro.motion[0]`) names the element rather than its position in
 * the render order.
 */
export function deriveSeed(globalSeed: number, elementPath: string): number {
  return fnv1a32(`${globalSeed >>> 0}:${elementPath}`);
}

/**
 * Deterministic pseudo-random stream (mulberry32) for compile-time procedurality: shake phases,
 * scramble glyphs, particle layouts. Returns floats in [0, 1).
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * JSON with object keys sorted at every depth, so two descriptors that differ only in key order hash
 * the same. `undefined` members are dropped exactly as JSON.stringify drops them.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);

  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortKeys(record[key]);
  }

  return sorted;
}

/** UTF-8 encode without TextEncoder (unavailable on some Hermes builds). */
export function utf8(input: string): Uint8Array {
  const bytes: number[] = [];

  for (const char of input) {
    pushCodePoint(bytes, char.codePointAt(0) ?? 0);
  }

  return Uint8Array.from(bytes);
}

function pushCodePoint(bytes: number[], code: number): void {
  if (code < 0x80) {
    bytes.push(code);

    return;
  }

  if (code < 0x800) {
    bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));

    return;
  }

  if (code < 0x10000) {
    bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));

    return;
  }

  bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
}
