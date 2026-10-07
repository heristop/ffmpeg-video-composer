// ---------------------------------------------------------------------------
// Dependency-free PNG encoder for compile-time generated images (panels, fx sprites)
// ---------------------------------------------------------------------------
//
// The engine also runs on React-Native/Hermes and in the browser/WASM, where there is no `Buffer` and no
// `zlib`, so images are hand-encoded with plain `Uint8Array` math and DEFLATE *stored* (uncompressed)
// blocks: no npm deps, no Node built-ins. The output is a pure function of the pixels, byte for byte.

/** 8-bit pixels, row-major, no padding: 1 channel = grayscale (colour type 0), 4 = RGBA (colour type 6). */
export interface PngImage {
  width: number;
  height: number;
  channels: 1 | 4;
  data: Uint8Array;
}

// CRC32 table for the standard PNG polynomial 0xEDB88320, built once at module load.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;

    for (let bit = 0; bit < 8; bit++) {
      const mask = -(c & 1);
      c = (c >>> 1) ^ (0xedb88320 & mask);
    }
    table[n] = c >>> 0;
  }

  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

// Adler32 over the raw image bytes — the zlib stream's trailing checksum.
function adler32(data: Uint8Array): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;

  for (const byte of data) {
    a = (a + byte) % MOD;
    b = (b + a) % MOD;
  }

  return ((b << 16) | a) >>> 0;
}

// The largest payload a single DEFLATE *stored* block can carry (its LEN field is 16-bit).
const MAX_STORED_BLOCK = 0xffff;

// Write the DEFLATE *stored* blocks for `raw` into `out` starting at `startPos`; returns the position
// just past the last block. Each block carries ≤65535 bytes; the final block sets BFINAL.
function writeStoredBlocks(out: Uint8Array, raw: Uint8Array, startPos: number): number {
  let pos = startPos;

  for (let offset = 0; offset < raw.length || offset === 0; offset += MAX_STORED_BLOCK) {
    const len = Math.min(MAX_STORED_BLOCK, raw.length - offset);
    const isFinal = offset + len >= raw.length;
    out[pos++] = isFinal ? 1 : 0; // BFINAL, BTYPE=00 (stored)
    out[pos++] = len & 0xff;
    out[pos++] = (len >>> 8) & 0xff;
    const nlen = ~len & 0xffff;
    out[pos++] = nlen & 0xff;
    out[pos++] = (nlen >>> 8) & 0xff;
    out.set(raw.subarray(offset, offset + len), pos);
    pos += len;

    if (isFinal) {
      break;
    }
  }

  return pos;
}

// Wrap raw bytes in a minimal zlib stream (0x78 0x01) using DEFLATE *stored* blocks — no compression,
// so no Hermes zlib dependency.
function zlibStore(raw: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(raw.length / MAX_STORED_BLOCK));
  // 2 header bytes + per block (1 flag + 2 LEN + 2 NLEN) + payload + 4 adler bytes.
  const out = new Uint8Array(2 + blockCount * 5 + raw.length + 4);
  let pos = 0;

  out[pos++] = 0x78;
  out[pos++] = 0x01;

  pos = writeStoredBlocks(out, raw, pos);

  const checksum = adler32(raw);
  out[pos++] = (checksum >>> 24) & 0xff;
  out[pos++] = (checksum >>> 16) & 0xff;
  out[pos++] = (checksum >>> 8) & 0xff;
  out[pos++] = checksum & 0xff;

  return out;
}

function uint32(out: Uint8Array, at: number, value: number): void {
  out[at] = (value >>> 24) & 0xff;
  out[at + 1] = (value >>> 16) & 0xff;
  out[at + 2] = (value >>> 8) & 0xff;
  out[at + 3] = value & 0xff;
}

// Encode one PNG chunk: length (uint32 BE) + type + data + CRC32(type+data) (uint32 BE).
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = new Uint8Array(4 + data.length);

  for (let i = 0; i < 4; i++) {
    typeAndData[i] = type.codePointAt(i) ?? 0;
  }
  typeAndData.set(data, 4);

  const out = new Uint8Array(12 + data.length);
  uint32(out, 0, data.length);
  out.set(typeAndData, 4);
  uint32(out, 8 + data.length, crc32(typeAndData));

  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;

  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }

  return out;
}

// The scanlines PNG stores: each row prefixed with its filter-type byte (0 = None).
function scanlines(image: PngImage): Uint8Array {
  const stride = image.width * image.channels;
  const raw = new Uint8Array(image.height * (stride + 1));

  for (let y = 0; y < image.height; y++) {
    raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  return raw;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** The PNG bytes of an 8-bit grayscale or RGBA image (straight alpha). Pure and deterministic. */
export function encodePng(image: PngImage): Uint8Array {
  const ihdr = new Uint8Array(13);
  uint32(ihdr, 0, image.width);
  uint32(ihdr, 4, image.height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = image.channels === 4 ? 6 : 0; // colour type: RGBA or grayscale
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none

  const idat = zlibStore(scanlines(image));

  return concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}
