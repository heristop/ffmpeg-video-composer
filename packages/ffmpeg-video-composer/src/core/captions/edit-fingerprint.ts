// The fingerprint a transcript pin records of its source section's edits (meta.resolved.transcripts[].edit):
// the options the source-to-section mapping reads (core/captions/transcript-time.ts), printed canonically
// and hashed, so `transcript_edit_changed` can tell a section re-cut since its words were pinned. Pure and
// dependency-free, so the on-device app fingerprints its pins the same way.

/** The section options a transcript's source-to-section mapping reads (core/captions/transcript-time.ts). */
const EDIT_FIELDS = ['clip', 'keep', 'trimSilence', 'speedRamp', 'freeze', 'speed', 'duration'] as const;

// JSON with sorted keys: the same edits always print the same, whatever order they were authored in.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  if (value === undefined) return 'null';

  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : Number(a > b)));

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
}

// FNV-1a, 32 bits: a change detector, not a security digest, and the same on every platform.
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;

  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic fingerprint of a section's transcript edits (clip, keep, trimSilence, ramp, freeze, speed, duration). */
export function editFingerprint(options: unknown): string {
  const source = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>;
  const picked = Object.fromEntries(EDIT_FIELDS.map((field) => [field, source[field]]));

  return `fnv1a:${fnv1a(canonical(picked))}`;
}
