// An animated card's frames, drawn as PNGs of one size by the HTML rasteriser, joined into one animated PNG
// without decoding a pixel: each frame's IDAT stream moves behind its own fcTL (full canvas, dispose none,
// blend source), the later ones as numbered fdAT chunks. A frame's delay counts output frames (ticks/fps),
// and FFmpeg's apng demuxer reads the delays as timestamps, so a held frame is stored once. Pure bytes, no
// zlib, no Node built-ins: it runs the same on Node, in the browser and on the phone.

import { chunk, concat, PNG_SIGNATURE } from '../presets/png-encode';

export interface ApngFrame {
  png: Uint8Array;
  /** How long the frame shows, in output frames. */
  ticks: number;
}

interface PngChunk {
  type: string;
  data: Uint8Array;
}

const MAX_TICKS = 0xffff;
const IHDR_LENGTH = 13;
const PALETTE_COLOUR_TYPE = 3;
const CHUNK_OVERHEAD = 12; // length, type and checksum around the data

function readUint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function writeUint32(out: Uint8Array, at: number, value: number): void {
  out[at] = (value >>> 24) & 0xff;
  out[at + 1] = (value >>> 16) & 0xff;
  out[at + 2] = (value >>> 8) & 0xff;
  out[at + 3] = value & 0xff;
}

function writeUint16(out: Uint8Array, at: number, value: number): void {
  out[at] = (value >>> 8) & 0xff;
  out[at + 1] = value & 0xff;
}

/** The chunks of a PNG up to IEND, in order; throws on bytes that are not a PNG or that end early. */
export function readPngChunks(png: Uint8Array): PngChunk[] {
  if (png.length < 8 || PNG_SIGNATURE.some((byte, index) => png[index] !== byte)) throw new Error('not a PNG');

  const chunks: PngChunk[] = [];
  let at = 8;

  while (at < png.length) {
    if (at + CHUNK_OVERHEAD > png.length) throw new Error('truncated PNG: incomplete chunk header');

    const length = readUint32(png, at);
    const type = String.fromCodePoint(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);

    if (length > png.length - at - CHUNK_OVERHEAD) throw new Error(`truncated ${type} chunk`);

    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += CHUNK_OVERHEAD + length;

    if (type === 'IEND') return chunks;
  }

  throw new Error('truncated PNG: no IEND chunk');
}

function header(chunks: PngChunk[], index: number): Uint8Array {
  const ihdr = chunks.find((c) => c.type === 'IHDR');

  if (!ihdr) throw new Error(`frame ${index} has no IHDR`);

  if (ihdr.data.length < IHDR_LENGTH) throw new Error(`frame ${index} has a short IHDR (${ihdr.data.length} bytes)`);

  if (ihdr.data[9] === PALETTE_COLOUR_TYPE) throw new Error(`frame ${index} is a palette PNG`);

  if (chunks.some((c) => c.type === 'tRNS')) throw new Error(`frame ${index} carries a tRNS chunk`);

  if (!chunks.some((c) => c.type === 'IDAT')) throw new Error(`frame ${index} has no image data`);

  return ihdr.data;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function frameControl(sequence: number, ihdr: Uint8Array, ticks: number, fps: number): Uint8Array {
  const data = new Uint8Array(26);

  writeUint32(data, 0, sequence);
  data.set(ihdr.subarray(0, 8), 4); // width, height: the full canvas
  writeUint32(data, 12, 0); // x offset
  writeUint32(data, 16, 0); // y offset
  writeUint16(data, 20, ticks); // delay numerator
  writeUint16(data, 22, fps); // delay denominator
  data[24] = 0; // dispose: none
  data[25] = 0; // blend: source (each frame replaces the canvas, transparency included)

  return chunk('fcTL', data);
}

function animationControl(frameCount: number): Uint8Array {
  const data = new Uint8Array(8);

  writeUint32(data, 0, frameCount);
  writeUint32(data, 4, 1); // plays once

  return chunk('acTL', data);
}

function checkFrames(frames: readonly ApngFrame[], parsed: PngChunk[][], ihdr: Uint8Array): void {
  for (const [index, chunks] of parsed.entries()) {
    if (!sameBytes(header(chunks, index), ihdr)) {
      throw new Error(`frame ${index} differs in size or format from frame 0`);
    }

    const ticks = frames[index].ticks;

    if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS) {
      throw new RangeError(`frame ${index} lasts ${ticks} ticks (1..${MAX_TICKS})`);
    }
  }
}

/**
 * One animated PNG playing `frames` once, each for `ticks / fps` seconds. `fps` is stored as a 16-bit delay
 * denominator, so it must be a whole number in 1..65535. Frames must be RGBA or RGB PNGs: palette PNGs are
 * not supported.
 */
export function assembleApng(frames: readonly ApngFrame[], fps: number): Uint8Array {
  if (!Number.isInteger(fps) || fps < 1 || fps > MAX_TICKS) {
    throw new RangeError(`frame rate ${fps} is not a whole number in 1..${MAX_TICKS}`);
  }

  if (frames.length === 0) throw new Error('an animated PNG needs at least one frame');

  const parsed = frames.map((frame) => readPngChunks(frame.png));
  const ihdr = header(parsed[0], 0);

  checkFrames(frames, parsed, ihdr);

  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr), animationControl(frames.length)];
  let sequence = 0;

  for (const [index, chunks] of parsed.entries()) {
    const stream = concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));

    parts.push(frameControl(sequence++, ihdr, frames[index].ticks, fps));

    if (index === 0) {
      parts.push(chunk('IDAT', stream));

      continue;
    }

    const data = new Uint8Array(4 + stream.length);

    writeUint32(data, 0, sequence++);
    data.set(stream, 4);
    parts.push(chunk('fdAT', data));
  }

  parts.push(chunk('IEND', new Uint8Array(0)));

  return concat(parts);
}
