import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { designedTransitionGraph } from '@/core/motion/transitions';
import { throughZoom } from '@/core/motion/transition-through';
import { boundaryMatte } from '@/core/motion/transition-mattes';
import { parseGlyphOutlines } from '@/core/glyph-outline';
import { boundaryTransitions } from '@/director/prepare-build';
import { matteInputArgs } from '@/editor/utils/matte-staging';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { TransitionSchema } from '@/schemas/effects.schemas';
import type { Section } from '@/core/types';

// zoom-through `through` a window: the camera flies into a letter's counter (or a shape) and the next scene
// shows through it until the window covers the frame. Without `through` it stays the plain fly-through.

const here = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO = path.resolve(here, '../../leclap-creative-kit/src/library/fonts/ArchivoBlack.ttf');

const BOUNDARY = {
  type: 'zoom-through' as const,
  left: 'vs0',
  right: 'vs1',
  out: 'v0',
  id: 'dt0',
  offset: 2,
  duration: 0.8,
  width: 1280,
  height: 720,
  fps: 30,
};

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

describe('zoom-through window: schema and boundary', () => {
  it('takes a text window or a shape window', () => {
    const ok = (through: unknown) => TransitionSchema.safeParse({ type: 'zoom-through', through }).success;

    expect(ok({ text: 'ZOOM', glyph: 1, font: 'archivo-black', size: 220, x: 640, y: 'center' })).toBe(true);
    expect(ok({ text: 'O' })).toBe(true);
    expect(ok({ shape: 'star', size: 160, x: 300, y: 200 })).toBe(true);
    expect(ok({ shape: 'star' })).toBe(false);
    expect(ok({ text: '' })).toBe(false);
    expect(ok({ text: 'O', colour: 'red' })).toBe(false);
  });

  it('carries the window to the boundary', () => {
    const sections = [{ name: 'a' }, { name: 'b' }] as unknown as Section[];
    const through = { text: 'ZOOM', font: 'archivo-black', size: 220 };

    expect(boundaryTransitions(sections, { type: 'zoom-through', duration: 0.8, through })).toEqual([
      { type: 'zoom-through', duration: 0.8, ease: undefined, through },
    ]);
  });
});

describe('zoom-through window: lowering', () => {
  const matte = { label: '4:v', centre: { x: 500, y: 300 }, scale: 15 };

  it('keeps the plain zoom-through byte-identical without a matte', () => {
    const plain = designedTransitionGraph(BOUNDARY);

    expect(plain).toContain('xfade=transition=fade');
    expect(plain).not.toContain('alphamerge');
  });

  it('zooms the tail and the matte through the same chain, about the window', () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, matte });
    const zoom = throughZoom({ ...BOUNDARY, tail: 't', in: 'i', mix: 'm' }, matte);

    expect(graph).toContain(`[dt0tail]${zoom}[dt0za];`);
    expect(graph).toContain(`[4:v]format=yuv420p,setsar=1,${zoom},format=gray[dt0zm];`);
    expect(graph).toContain('[dt0zb][dt0zm]alphamerge[dt0zi];[dt0za][dt0zi]overlay=0:0[dt0mix]');
    // ×2 exact, then one ×10 zoompan stage about the centre (scale 15).
    expect(zoom.match(/zoompan=/g)).toHaveLength(2);
    expect(zoom).toContain(":x='500*(1-1/zoom)':y='300*(1-1/zoom)':d=1:s=1280x720:fps=30");
    expect(zoom).toContain(`max(1,min(10,exp(2.70805*(`);
    expect(
      throughZoom({ ...BOUNDARY, tail: 't', in: 'i', mix: 'm' }, { ...matte, scale: 150 }).match(/zoompan=/g)
    ).toHaveLength(3);
    expect(
      throughZoom({ ...BOUNDARY, tail: 't', in: 'i', mix: 'm' }, { ...matte, scale: 1.8 }).match(/zoompan=/g)
    ).toHaveLength(1);
  });

  it('uses on-device filters only and is deterministic', () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, matte });
    const filters = new Set([...graph.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)].map((m) => m[1]));

    for (const filter of filters) expect(DEVICE_FILTERS.has(filter), filter).toBe(true);
    expect(graph).toBe(designedTransitionGraph({ ...BOUNDARY, matte }));
  });
});

// Real FFmpeg: black → white through the counter of an O drawn by the matte. At the start the white shows
// only inside the counter; it grows; at the end the frame is white.
describe.skipIf(!hasFfmpeg())('zoom through an O on real frames', () => {
  it('shows the next scene only through the counter, then fully', { timeout: 300_000 }, () => {
    const [W, H, FPS, D] = [640, 360, 30, 0.8];
    const font = parseGlyphOutlines(new Uint8Array(fs.readFileSync(ARCHIVO)));
    const result = boundaryMatte(
      { type: 'zoom-through', through: { text: 'ZOOM', font: 'archivo-black', size: 150 } },
      { width: W, height: H },
      font
    );
    const m = result.matte;

    if (!m) throw new Error('no matte');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoom-window-'));
    const file = path.join(dir, m.name);
    fs.writeFileSync(file, m.png());

    const graph =
      `color=c=black:s=${W}x${H}:r=${FPS}:d=2,format=yuv420p,settb=AVTB[vs0];` +
      `color=c=white:s=${W}x${H}:r=${FPS}:d=2,format=yuv420p,settb=AVTB[vs1];` +
      designedTransitionGraph({
        ...BOUNDARY,
        width: W,
        height: H,
        offset: 0.5,
        duration: D,
        matte: { label: '0:v', centre: m.centre, scale: m.scale },
      });
    const raw = execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        ...matteInputArgs(file, FPS, D).trim().split(/\s+/),
        '-filter_complex',
        graph,
        '-map',
        '[v0]',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-',
      ],
      { maxBuffer: 1 << 28 }
    );
    const frames = Array.from({ length: raw.length / (W * H) }, (_, i) => raw.subarray(i * W * H, (i + 1) * W * H));
    const matte = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    const first = frames[15];
    let [both, either, outside] = [0, 0, 0];

    for (let p = 0; p < W * H; p++) {
      const window = matte[p] > 128;
      const shown = first[p] > 128;

      if (window && shown) both++;

      if (window || shown) either++;

      if (!window && matte[p] < 8 && first[p] > 40) outside++;
    }

    expect(both / either).toBeGreaterThan(0.9);
    expect(outside).toBe(0);

    const lit = (frame: Buffer) => frame.reduce((n, v) => n + (v > 128 ? 1 : 0), 0);

    expect(lit(frames[15 + 12])).toBeGreaterThan(lit(first) * 4);
    expect(Math.min(...frames[15 + 23])).toBeGreaterThan(230);
    expect(Math.min(...frames[15 + 24])).toBeGreaterThan(245);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
