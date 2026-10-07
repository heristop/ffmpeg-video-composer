import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testBuildDir } from './fixtures/build-dir';
import { hasFfmpeg, lowerGraphic } from './fixtures/fx-test-kit';

// A wide leak over a dark flat backdrop, encoded the way the engine's final pass encodes it (libx264
// ultrafast, crf 23): the light's tail must keep its dither through the encode. A dither the encoder
// smooths away leaves the falloff as flat 1-code-value bands, i.e. long runs of identical luma along a row.

const [W, H] = [640, 360];
const BACKDROP = 'color=c=0x303040:s=640x360:r=30:d=2';
const T = '1.2';
const dir = testBuildDir('fx-banding');

function hasX264(): boolean {
  if (!hasFfmpeg()) return false;

  return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes('libx264');
}

// Luma plane of the frame at T: of the graph itself (`encode` false) or of its ultrafast encode.
function luma(graph: string, name: string, encode: boolean): Buffer {
  const file = path.join(dir, `${name}.mp4`);
  const lavfi = `${BACKDROP},format=yuv420p${graph ? `,${graph}` : ''}`;

  fs.mkdirSync(dir, { recursive: true });

  if (encode) {
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-filter_complex',
      lavfi,
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-tune',
      'film',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
  }

  const input = encode ? ['-ss', T, '-i', file] : ['-filter_complex', lavfi, '-ss', T];

  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', ...input, '-frames:v', '1', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', '-'],
    { maxBuffer: 1 << 26 }
  );

  return raw.subarray(0, W * H);
}

function columnMean(frame: Buffer, x: number, rows: number[]): number {
  return rows.reduce((sum, y) => sum + frame[y * W + x], 0) / rows.length;
}

// The light's tail on the rows: the columns where the lift over the backdrop is 1..8 code values.
function tail(frame: Buffer, rows: number[]): [number, number] {
  const floor = frame[(H >> 1) * W + W - 1];
  const lift = Array.from({ length: W }, (_, x) => columnMean(frame, x, rows) - floor);
  const start = lift.findIndex((value) => value <= 8);

  return [start, lift.findIndex((value, x) => x > start && value < 1)];
}

/** Mean length of the runs of identical luma along the rows, over columns [from, to). */
function meanRun(frame: Buffer, rows: number[], [from, to]: [number, number]): number {
  const runs = rows.map((y) => {
    let count = 1;

    for (let x = from + 1; x < to; x += 1) {
      if (frame[y * W + x] !== frame[y * W + x - 1]) count += 1;
    }

    return (to - from) / count;
  });

  return runs.reduce((sum, run) => sum + run, 0) / runs.length;
}

const LEAK = { effect: 'leak', duration: 2, size: 0.6, intensity: 1, edge: 'left' };

describe.skipIf(!hasX264())('fx soft-light dither through an ultrafast encode', () => {
  const rows = Array.from({ length: 48 }, (_, i) => 60 + i);

  function measure(has: (filter: string) => boolean, name: string): { pre: number; encoded: number } {
    const { text } = lowerGraphic(LEAK, { scale: `${W}:${H}`, has });
    const before = luma(text, name, false);
    const span = tail(before, rows);

    expect(span[1] - span[0]).toBeGreaterThan(60);

    return { pre: meanRun(before, rows, span), encoded: meanRun(luma(text, name, true), rows, span) };
  }

  it('keeps the tail dithered after the encode (the plain ±1 alpha dither comes out as flat bands)', () => {
    const shaped = measure(() => true, 'shaped');
    const plain = measure((filter) => filter !== 'gblur', 'plain');

    // Before the encode both are dithered (runs of 1-2 px); after it the plain dither is gone (runs of
    // about 10 px, the band width) while the shaped grain still breaks every few pixels.
    expect(plain.pre).toBeLessThan(3);
    expect(plain.encoded).toBeGreaterThan(7);
    expect(shaped.encoded).toBeLessThan(5);
    expect(shaped.encoded).toBeLessThan(plain.encoded / 2);
  });
});
