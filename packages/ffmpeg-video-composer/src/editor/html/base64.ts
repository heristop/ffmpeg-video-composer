// Base64 without Buffer, btoa or atob (none is on every engine the core runs on: Hermes lacks Buffer).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;

    out += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    out += index + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : '=';
    out += index + 2 < bytes.length ? ALPHABET[triple & 63] : '=';
  }

  return out;
}

const VALUES = new Map(Array.from({ length: ALPHABET.length }, (_, index) => [ALPHABET[index], index]));

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let at = 0;

  for (let index = 0; index < clean.length; index += 4) {
    const quad = [0, 1, 2, 3].map((offset) => VALUES.get(clean[index + offset] ?? 'A') ?? 0);
    const triple = (quad[0] << 18) | (quad[1] << 12) | (quad[2] << 6) | quad[3];

    for (const shift of [16, 8, 0]) {
      if (at < bytes.length) bytes[at++] = (triple >> shift) & 255;
    }
  }

  return bytes;
}
