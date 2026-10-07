// Stable identity for a template (or any JSON document): SHA-256 over canonical JSON, so object key
// ordering never changes a revision. Synchronous and platform-neutral (the engine's own sha256Hex), so
// the MCP server (Node) and the web builder (browser) compute byte-identical revisions for the same JSON.

import { canonicalJson } from './hash';
import { sha256Hex } from './sha256';

const SURROGATE = /[\uD800-\uDFFF]/;

// Lone UTF-16 surrogates are not valid UTF-8; Node's hashing replaces each one with U+FFFD, so mirror
// that here and stay hex-identical with a `node:crypto` digest of the same text.
function wellFormed(text: string): string {
  if (!SURROGATE.test(text)) return text;
  let out = '';

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code >= 0xd800 && code <= 0xdfff ? '�' : char;
  }

  return out;
}

/** Lower-case hex SHA-256 of the canonical JSON of `template`; object key ordering does not affect it. */
export function templateRevision(template: Record<string, unknown>): string {
  return sha256Hex(wellFormed(canonicalJson(template)));
}
