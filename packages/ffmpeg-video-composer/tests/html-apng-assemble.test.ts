import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { assembleApng, readPngChunks } from '@/editor/html/apng-assemble';
import { chunk, concat, crc32, encodePng, PNG_SIGNATURE } from '@/editor/presets/png-encode';

function solid(rgba: [number, number, number, number], width = 4, height = 2): Uint8Array {
  const data = new Uint8Array(width * height * 4);

  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);

  return encodePng({ width, height, channels: 4, data });
}

// The same image with its IDAT stream cut into two chunks, as encoders that flush in blocks write it.
function splitIdat(png: Uint8Array): Uint8Array {
  const parts = readPngChunks(png).flatMap((c) => {
    if (c.type !== 'IDAT') return [chunk(c.type, c.data)];

    const half = Math.floor(c.data.length / 2);

    return [chunk('IDAT', c.data.subarray(0, half)), chunk('IDAT', c.data.subarray(half))];
  });

  return concat([PNG_SIGNATURE, ...parts]);
}

const u32 = (data: Uint8Array, at: number) => new DataView(data.buffer, data.byteOffset).getUint32(at);
const u16 = (data: Uint8Array, at: number) => new DataView(data.buffer, data.byteOffset).getUint16(at);
const streamOf = (png: Uint8Array) =>
  concat(
    readPngChunks(png)
      .filter((c) => c.type === 'IDAT')
      .map((c) => c.data)
  );

const RED = solid([255, 0, 0, 255]);
const GREEN = splitIdat(solid([0, 255, 0, 255]));
const BLUE = solid([0, 0, 255, 128]);

describe('assembleApng', () => {
  const apng = assembleApng(
    [
      { png: RED, ticks: 3 },
      { png: GREEN, ticks: 1 },
      { png: BLUE, ticks: 2 },
    ],
    10
  );
  const chunks = readPngChunks(apng);

  it('writes a frame control per frame and the later frames as numbered fdAT chunks', () => {
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'fcTL', 'fdAT', 'IEND']);
    expect([u32(chunks[1].data, 0), u32(chunks[1].data, 4)]).toEqual([3, 1]);

    const controls = chunks.filter((c) => c.type === 'fcTL').map((c) => c.data);

    expect(controls.map((d) => u32(d, 0))).toEqual([0, 1, 3]);
    expect(controls.map((d) => [u16(d, 20), u16(d, 22)])).toEqual([
      [3, 10],
      [1, 10],
      [2, 10],
    ]);
    expect(controls.map((d) => [u32(d, 4), u32(d, 8), d[24], d[25]])).toEqual(Array(3).fill([4, 2, 0, 0]));
    expect(chunks.filter((c) => c.type === 'fdAT').map((c) => u32(c.data, 0))).toEqual([2, 4]);
  });

  it("moves each frame's whole image stream, its IDAT chunks joined", () => {
    expect(chunks[3].data).toEqual(streamOf(RED));
    expect(chunks[5].data.subarray(4)).toEqual(streamOf(GREEN));
  });

  it('checksums every chunk', () => {
    let at = 8;

    for (const c of chunks) {
      expect(u32(apng, at + 8 + c.data.length)).toBe(crc32(apng.subarray(at + 4, at + 8 + c.data.length)));
      at += 12 + c.data.length;
    }
  });

  it('refuses no frames, frames of different sizes and a hold over 65535 ticks', () => {
    expect(() => assembleApng([], 30)).toThrow(/at least one frame/);
    expect(() =>
      assembleApng(
        [
          { png: RED, ticks: 1 },
          { png: solid([0, 0, 0, 255], 2, 2), ticks: 1 },
        ],
        30
      )
    ).toThrow(/frame 1 differs/);
    expect(() => assembleApng([{ png: RED, ticks: 70_000 }], 30)).toThrow(/ticks/);
  });

  it('throws on truncated or non-PNG bytes instead of reading past the end', () => {
    expect(() => readPngChunks(RED.subarray(0, RED.length - 20))).toThrow(/truncated/);
    expect(() => readPngChunks(RED.subarray(0, 20))).toThrow(/truncated/);
    expect(() => readPngChunks(new Uint8Array([1, 2, 3]))).toThrow(/not a PNG/);
    expect(() => assembleApng([{ png: RED.subarray(0, 40), ticks: 1 }], 30)).toThrow(/truncated/);

    const huge = RED.slice();

    huge.set([0xff, 0xff, 0xff, 0xff], 8);

    expect(() => readPngChunks(huge)).toThrow(/truncated/);
  });

  it('decodes in FFmpeg with the delays as timestamps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-apng-'));
    const file = path.join(dir, 'card.apng');

    fs.writeFileSync(file, apng);

    const probe = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file];
    const times = execFileSync('ffprobe', probe, { encoding: 'utf8' }).trim().split('\n').map(Number);
    const second = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      String.raw`select=eq(n\,1)`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      'pipe:1',
    ]);

    expect(times).toEqual([0, 0.3, 0.4]);
    expect([...second.subarray(0, 4)]).toEqual([0, 255, 0, 255]);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each([29.97, 0, -1, 65536, Number.NaN, Number.POSITIVE_INFINITY])('refuses a frame rate of %s', (fps) => {
    expect(() => assembleApng([{ png: RED, ticks: 1 }], fps)).toThrow(/frame rate/);
  });
});
