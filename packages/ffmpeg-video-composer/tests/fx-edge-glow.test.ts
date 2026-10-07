import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSpriteUrl, spriteImage, type SpriteSpec } from '@/editor/presets/fx-sprites';
import { hasFfmpeg, lowerGraphic, lumaAt, renderFrames, type Lowered } from './fixtures/fx-test-kit';
import { testBuildDir } from './fixtures/build-dir';

const CARD = { x: 256, y: 172, w: 768, h: 374, radius: 24 };
const glow = (graphic: Record<string, unknown> = {}, options = {}): Lowered =>
  lowerGraphic({ effect: 'edge-glow', target: CARD, ...graphic }, options);
const specs = (lowered: Lowered): SpriteSpec[] => lowered.urls.map((url) => parseSpriteUrl(url) as SpriteSpec);

describe('fx edge-glow: graph', () => {
  it('draws on the target grown by the bloom reach, with a glow sprite and a hairline sprite at exact size', () => {
    const lowered = glow({ spread: 10 });
    const [bloom, line] = specs(lowered);
    const crop = /crop=(\d+):(\d+):(\d+):(\d+)/.exec(lowered.text)?.slice(1).map(Number) ?? [];
    const m = bloom.inset as number;

    expect(lowered.warnings).toEqual([]);
    expect(bloom).toMatchObject({ kind: 'glow', w: CARD.w + 2 * m, h: CARD.h + 2 * m, radius: 24 });
    expect(line).toMatchObject({ kind: 'stroke', w: CARD.w, h: CARD.h, radius: 24, stroke: 1 });
    expect(m % 2).toBe(0);
    expect(crop).toEqual([CARD.w + 2 * m, CARD.h + 2 * m, CARD.x - m, CARD.y - m]);
    // Never clipped to the target: the bloom must leave it.
    expect(lowered.text).not.toContain('alphamerge');
    // Each sprite is processed once and held, never scaled.
    expect(lowered.text).not.toContain('scale=');
    expect(lowered.text.match(/loop=loop=\d+:size=1/g)).toHaveLength(2);
    expect(lowered.text).toContain(`overlay=x='${m}':y='${m}'`);
  });

  it('clamps the canvas to the frame and keeps the target in place inside it', () => {
    const lowered = glow({}, { scale: '1280:720' });
    const edge = lowerGraphic({ effect: 'edge-glow', target: { x: 0, y: 0, w: 400, h: 300 } });
    const crop = /crop=(\d+):(\d+):(\d+):(\d+)/.exec(edge.text)?.slice(1).map(Number) ?? [];
    const m = specs(edge)[0].inset as number;

    expect(crop).toEqual([400 + m, 300 + m, 0, 0]);
    expect(edge.text).toContain(`overlay=x='-${m}':y='-${m}'`);
    expect(lowered.text).toContain('crop=');
  });

  it('breathes through hue brightness on a sine, off under reduced motion or without hue', () => {
    expect(glow({ period: 4 }).text).toMatch(/hue=b='[\d.]+\*sin\(2\*PI\*\(t-0.3\)\/4\)'/);
    expect(glow({ breathe: 0 }).text).not.toContain('hue=');
    expect(glow({}, { energy: 0 }).text).not.toContain('hue=');
    expect(glow({}, { has: (f: string) => f !== 'hue' }).text).not.toContain('hue=');
  });

  it('keeps a portrait card sharp: sprites match a tall target exactly', () => {
    const tall = { x: 120, y: 300, w: 480, h: 640, radius: 32 };
    const [bloom, line] = specs(lowerGraphic({ effect: 'edge-glow', target: tall }, { scale: '720:1280' }));

    expect(line).toMatchObject({ w: 480, h: 640 });
    expect(bloom.w - 2 * (bloom.inset as number)).toBe(480);
    expect(bloom.h - 2 * (bloom.inset as number)).toBe(640);
  });

  it('honours its parameters and is deterministic per seed', () => {
    const look = (lowered: Lowered): string => `${lowered.text}|${lowered.urls.join('|')}`;
    const base = look(glow());

    for (const change of [
      { line: 0.9 },
      { lineWidth: 4 },
      { spread: 20 },
      { glow: '#33AAFF' },
      { breathe: 0.15 },
      { period: 8 },
      { intensity: 1 },
    ]) {
      expect(look(glow(change)), JSON.stringify(change)).not.toBe(base);
    }

    expect(look(glow())).toBe(base);
    expect(glow({ line: 0 }).urls).toHaveLength(1);
    expect(new Set([1, 2, 3, 4].map((seed) => glow({}, { seed }).urls[0])).size).toBeGreaterThan(1);
    expect(specs(glow({ glow: '#33AAFF' }))[0].color).toBe('33aaff');
  });
});

describe('fx glow sprite', () => {
  it('is exactly transparent inside the rounded rect, peaks at its edge and falls off outward', () => {
    const image = spriteImage({ kind: 'glow', w: 120, h: 80, inset: 20, radius: 10, sigma: 6, peak: 0.5 });
    const alpha = (x: number, y: number): number => image.data[(y * 120 + x) * 4 + 3];

    expect(alpha(60, 40)).toBe(0);
    expect(alpha(21, 40)).toBe(0);
    expect(alpha(19, 40)).toBeGreaterThan(alpha(14, 40));
    expect(alpha(14, 40)).toBeGreaterThan(alpha(8, 40));
    expect(alpha(19, 40)).toBeLessThanOrEqual(Math.round(255 * 0.5));
    expect(alpha(0, 40)).toBeLessThanOrEqual(1);
  });
});

// Real FFmpeg: the bloom lights the surround only, the hairline is inside the edge, the card's interior
// is never touched, nothing remains after the window, and two renders are byte-identical.
const W = 320;
const H = 180;
const T = { x: 80, y: 46, w: 160, h: 88 };
const dir = testBuildDir('fx-edge-glow-render');
const ready = hasFfmpeg();
const frames: Record<string, Buffer[]> = {};
const BASE = `color=c=0x121826:s=${W}x${H}:r=30:d=1.4,format=yuv420p,drawbox=x=${T.x}:y=${T.y}:w=${T.w}:h=${T.h}:color=0x6A7486:t=fill`;
const SPEC = { base: BASE, width: W, height: H, seconds: 1.4, dir };

beforeAll(() => {
  if (!ready) return;

  const lowered = lowerGraphic(
    { effect: 'edge-glow', target: T, duration: 1, intensity: 1, line: 0.8, lineWidth: 3 },
    { scale: `${W}:${H}`, at: 0.2 }
  );

  frames.fx = renderFrames({ ...SPEC, name: 'glow' }, lowered);
  frames.again = renderFrames({ ...SPEC, name: 'glow-again' }, lowered);
  frames.none = renderFrames({ ...SPEC, name: 'none' }, null);
}, 120000);

describe.skipIf(!ready)('fx edge-glow on real frames', () => {
  const lift = (i: number, x: number, y: number): number =>
    lumaAt(frames.fx[i], W, x, y) - lumaAt(frames.none[i], W, x, y);
  const mid = 21;

  it('blooms outside the rect and draws the hairline just inside its edge', () => {
    expect(lift(mid, T.x - 3, T.y + 40)).toBeGreaterThan(3);
    expect(lift(mid, T.x + 80, T.y - 3)).toBeGreaterThan(3);
    expect(lift(mid, T.x, T.y + 40)).toBeGreaterThan(10);
    expect(lift(mid, T.x - 3, T.y + 40)).toBeGreaterThan(lift(mid, T.x - 12, T.y + 40));
  });

  it('never touches the interior of the card', () => {
    for (const [i] of frames.fx.entries()) {
      for (let y = T.y + 4; y < T.y + T.h - 4; y += 3) {
        for (let x = T.x + 4; x < T.x + T.w - 4; x += 3) expect(lift(i, x, y)).toBe(0);
      }
    }
  });

  it('is gone after its window and renders byte-identically', () => {
    expect(frames.fx.at(-1)?.equals(frames.none.at(-1) as Buffer)).toBe(true);
    expect(frames.fx[3].equals(frames.none[3])).toBe(true);

    const sha = (list: Buffer[]): string => createHash('sha256').update(Buffer.concat(list)).digest('hex');

    expect(sha(frames.fx)).toBe(sha(frames.again));
  });
});
