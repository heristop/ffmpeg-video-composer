// The tool layer's safety rails: input size bounds, a sanitizer for agent-written text, per-kind rate
// limits and the media URL policy. Agent input is untrusted: it may carry control or bidi-override
// characters meant to spoof the UI, oversized payloads, or URLs that would pull foreign or local data
// (blob:, data:, file:) into a render. Pure; the clock is injected.
import type { ToolKind } from './types';

/** Largest raw input (JSON of the arguments), in UTF-8 bytes. */
export const MAX_INPUT_BYTES = 512 * 1024;
/** Longest on-screen text an agent may write. */
export const MAX_SCREEN_TEXT = 500;
/** Longest free-text argument (queries, notes). */
export const MAX_STRING = 4000;

// C0/C1 controls except \n and \t, and the bidi embedding/override/isolate characters.
function unsafeCodePoint(code: number): boolean {
  if (code === 0x09 || code === 0x0a) return false;

  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** NFC-normalized text without control or bidi-override characters. */
export function sanitizeText(value: string): string {
  let out = '';

  for (const char of value.normalize('NFC')) {
    if (!unsafeCodePoint(char.codePointAt(0) ?? 0)) out += char;
  }

  return out;
}

/** `value` with every string leaf sanitized (agent-written JSON values). */
export function sanitizeDeep(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeText(value);

  if (Array.isArray(value)) return value.map(sanitizeDeep);

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, sanitizeDeep(inner)]));
  }

  return value;
}

export function inputBytes(input: unknown): number {
  const json = JSON.stringify(input ?? {});

  return new TextEncoder().encode(json).length;
}

interface Window {
  limit: number;
  windowMs: number;
}

/** Calls allowed per sliding window, by tool kind. Consequential calls are also one at a time. */
export const RATE_LIMITS: Record<ToolKind, Window> = {
  read: { limit: 60, windowMs: 10_000 },
  edit: { limit: 20, windowMs: 10_000 },
  consequential: { limit: 6, windowMs: 60_000 },
};

export type RateDecision = { ok: true } | { ok: false; retryAfterMs: number };

export interface RateLimiter {
  take: (kind: ToolKind) => RateDecision;
}

export function createRateLimiter(now: () => number, limits: Record<ToolKind, Window> = RATE_LIMITS): RateLimiter {
  const calls: Record<ToolKind, number[]> = { read: [], edit: [], consequential: [] };

  return {
    take: (kind) => {
      const { limit, windowMs } = limits[kind];
      const time = now();
      const recent = calls[kind].filter((at) => time - at < windowMs);
      calls[kind] = recent;

      if (recent.length >= limit) return { ok: false, retryAfterMs: Math.max(1, windowMs - (time - recent[0])) };

      recent.push(time);

      return { ok: true };
    },
  };
}

/** Every string leaf of a JSON value. */
export function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);

    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) stringLeaves(item, out);

    return out;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) stringLeaves(item, out);
  }

  return out;
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const BLOCKED_SCHEMES = new Set(['blob', 'data', 'javascript', 'file', 'vbscript', 'filesystem']);

// Why a URL the agent introduced is refused, or null when it may stay.
function refusal(value: string, origin: string): string | null {
  const scheme = SCHEME.exec(value.trim())?.[1].toLowerCase();

  if (!scheme) return null;

  if (BLOCKED_SCHEMES.has(scheme)) return `${scheme}: URLs are not allowed`;

  if (scheme === 'media') return 'media:// refs must already be in the template (the user uploads media)';

  if (scheme !== 'http' && scheme !== 'https') return null;

  try {
    return new URL(value.trim()).origin === origin ? null : 'only same-origin https URLs are allowed';
  } catch {
    return 'invalid URL';
  }
}

/**
 * URLs the candidate introduces that the policy refuses: blob/data/javascript/file URLs, media:// refs
 * the template did not already hold, and http(s) URLs to another origin. Library ids and bundled paths
 * pass; anything already in the base template is kept as is.
 */
export function unsafeNewUrls(base: unknown, candidate: unknown, origin: string): string[] {
  const existing = new Set(stringLeaves(base));
  const problems: string[] = [];

  for (const value of new Set(stringLeaves(candidate))) {
    if (existing.has(value)) continue;

    const reason = refusal(value, origin);

    if (reason) problems.push(`${value.slice(0, 80)}: ${reason}`);
  }

  return problems;
}
