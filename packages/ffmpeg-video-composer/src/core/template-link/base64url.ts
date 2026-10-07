// RFC 4648 §5 base64url without padding, in plain JS: `btoa`/`atob` are missing on Hermes and
// `Uint8Array.prototype.toBase64` is not in every browser the builder supports yet.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map(Array.from(ALPHABET, (char, index) => [char, index]));

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const kept = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));

    for (let k = 0; k < kept; k++) out += ALPHABET[(chunk >> (18 - k * 6)) & 63];
  }

  return out;
}

function sextet(text: string, index: number): number {
  const value = LOOKUP.get(text[index]);

  if (value === undefined) throw new Error(`invalid base64url character at ${String(index)}`);

  return value;
}

/** The bytes of `text`; throws on a character outside the alphabet or an impossible length. */
export function fromBase64Url(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new Error('invalid base64url length');

  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let written = 0;

  for (let i = 0; i < text.length; i += 4) {
    let chunk = 0;

    for (let k = 0; k < 4; k++) chunk = (chunk << 6) | (i + k < text.length ? sextet(text, i + k) : 0);

    for (let k = 0; k < 3 && written < out.length; k++) out[written++] = (chunk >> (16 - k * 8)) & 255;
  }

  return out;
}
