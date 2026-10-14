import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Filter, Section } from '@/core/types';
import { parseEasing } from '@/core/motion/easing';
import { lowerFx } from '@/editor/presets/fx';
import { gooPlan, gooThreshold, GOO_POP_EASE } from '@/editor/presets/fx-goo';
import { parseSpriteUrl, spritePng, type SpriteSpec } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { renderFilterGraph } from '@/editor/utils/filter-graph';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { FX_PRIMITIVES, FxGraphicSchema, type FxGraphic, type FxGraphicOf } from '@/schemas/fx.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';
import { testBuildDir } from './fixtures/build-dir';

// fx "goo": blobs that move, stretch, split and merge, drawn as soft discs, united, then cut by a hard (but
// anti-aliased) threshold so nearby blobs fuse with smooth necks.

const FPS = 30;
const SECTION = 2;
const [WIDTH, HEIGHT] = [480, 270];
const dir = testBuildDir('fx-goo');

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

function filterText(filter: Filter): string {
  return filter.value === undefined ? filter.type : `${filter.type}=${String(filter.value)}`;
}

function sugar(inputs: string[], energy = 1): SugarContext {
  return {
    duration: SECTION,
    scale: `${WIDTH}:${HEIGHT}`,
    fps: FPS,
    isVideo: false,
    motion: { energy, seedFor: () => 5, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        inputs.push(`${key}=${'url' in source ? source.url : ''}`);

        return `input:${key}`;
      },
      color: (color) => color,
      warn: (message) => {
        throw new Error(message);
      },
      has: () => true,
    },
  };
}

function goo(fields: Record<string, unknown> = {}): FxGraphic {
  return FxGraphicSchema.parse({ type: 'fx', effect: 'goo', ...fields });
}

function lower(graphic: FxGraphic, inputs: string[] = [], energy = 1): Filter[] {
  const section = { name: 's', type: 'color_background', graphics: [graphic] } as unknown as Section;

  return lowerFx({ graphic, at: 0, until: undefined, seed: 9, index: 0, section, ctx: sugar(inputs, energy) });
}

function graphText(graphic: FxGraphic, inputs: string[] = []): string {
  const filters = lower(graphic, inputs);
  const keys = inputs.map((entry) => entry.slice(0, entry.indexOf('=')));

  return filters[0]?.graph ? renderFilterGraph(filters[0].graph, filterText, (key) => keys.indexOf(key)) : '';
}

describe('goo: schema', () => {
  it('is an fx primitive with blobs, keyframe tracks and choreography fields', () => {
    expect(Object.keys(FX_PRIMITIVES)).toContain('goo');
    expect(goo().effect).toBe('goo');
    expect(
      FxGraphicSchema.safeParse({
        type: 'fx',
        effect: 'goo',
        blobs: [
          {
            x: 0.3,
            y: 0.5,
            r: 0.1,
            animate: {
              x: [
                { t: 0, v: 0.3 },
                { t: 1, v: 0.6, ease: '$smooth' },
              ],
            },
          },
          {
            x: 0.6,
            y: 0.5,
            r: 0.08,
            animate: {
              r: [
                { t: 0, v: 0 },
                { t: 0.4, v: 0.08 },
              ],
            },
          },
        ],
        goo: 0.7,
      }).success
    ).toBe(true);
    expect(FxGraphicSchema.safeParse({ type: 'fx', effect: 'goo', droplets: 3, spread: 0.3, angle: 10 }).success).toBe(
      true
    );
    expect(FxGraphicSchema.safeParse({ type: 'fx', effect: 'goo', blobs: [] }).success).toBe(false);
    expect(FxGraphicSchema.safeParse({ type: 'fx', effect: 'goo', blobs: [{ x: 0.5, y: 0.5 }] }).success).toBe(false);
    expect(FxGraphicSchema.safeParse({ type: 'fx', effect: 'goo', goo: 2 }).success).toBe(false);
    expect(FxGraphicSchema.safeParse({ type: 'fx', effect: 'goo', droplets: 9 }).success).toBe(false);
    expect(
      FxGraphicSchema.safeParse({ type: 'fx', effect: 'goo', blobs: [{ x: 0.5, y: 0.5, r: 0.1, animate: { z: [] } }] })
        .success
    ).toBe(false);
  });

  it('pops in with a single overshoot of at most 8 %', () => {
    const fn = parseEasing(GOO_POP_EASE).fn;
    const peak = Math.max(...Array.from({ length: 201 }, (_, i) => fn(i / 200)));

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(1.08);
    const split = parseEasing(FX_PRIMITIVES.goo.defaults.ease).fn;

    expect(Math.max(...Array.from({ length: 201 }, (_, i) => split(i / 200)))).toBeLessThanOrEqual(1.08);
  });
});

describe('goo: validation', () => {
  const validator = new TemplateValidator();

  function findings(blobs: unknown[]): string[][] {
    const descriptor = {
      sections: [
        {
          name: 'goo',
          type: 'color_background',
          options: { backgroundColor: '#141416', duration: 3 },
          graphics: [{ type: 'fx', effect: 'goo', color: '#9298fb', blobs }],
        },
      ],
    };

    return (validator.validateTemplate(descriptor).errors ?? []).map((error) => [
      error.code,
      error.path,
      error.message,
    ]);
  }

  it('accepts keyframed blobs and reports keys out of order', () => {
    const track = [
      { t: 0.2, v: 0.4 },
      { t: 1, v: 0.6, ease: '$smooth' },
    ];

    expect(
      findings([
        {
          x: 0.4,
          y: 0.5,
          r: 0.1,
          animate: {
            x: track,
            r: [
              { t: 0, v: 0 },
              { t: 0.5, v: 0.1 },
            ],
          },
        },
      ])
    ).toEqual([]);
    expect(
      findings([
        {
          x: 0.4,
          y: 0.5,
          r: 0.1,
          animate: {
            y: [
              { t: 1, v: 0.5 },
              { t: 0.5, v: 0.6 },
            ],
          },
        },
      ])
    ).toEqual([
      ['invalid_keyframes', 'sections[0].graphics[0].blobs[0].animate.y', 'key 1 (t=0.5) is not after key 0'],
    ]);
  });
});

describe('goo: plan and lowering', () => {
  it('maps the goo amount to the threshold', () => {
    expect(gooThreshold(undefined)).toBeCloseTo(0.5);
    expect(gooThreshold(0)).toBeCloseTo(0.3);
    expect(gooThreshold(1)).toBeCloseTo(0.7);
  });

  it('choreographs a seeded split: a main blob and 2–3 droplets that leave and come back', () => {
    const inputs: string[] = [];
    const graph = graphText(goo({ duration: 2 }), inputs);

    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatch(/^fx0_blob=sprite:kind=disc,w=\d+,h=\d+,sigma=/);
    const overlays = graph.match(/overlay=x='/g) ?? [];

    expect(overlays.length).toBeGreaterThanOrEqual(3 + 1);
    expect(overlays.length).toBeLessThanOrEqual(4 + 1);
    expect(graph).toContain("lutyuv=y='255*clip((val-125.5)/");
    expect(graph).toContain('alphamerge');
    expect(graph).toContain('eval=frame');
  });

  it('keeps the canvas to the bounding region of the blobs, not the frame', () => {
    const graphic = goo({
      blobs: [
        { x: 0.3, y: 0.5, r: 0.1 },
        { x: 0.45, y: 0.5, r: 0.1 },
      ],
    });
    const graph = graphText(graphic);
    const canvas = /color=c=black:s=(\d+)x(\d+)/.exec(graph);

    expect(canvas).not.toBeNull();
    expect(Number(canvas?.[1])).toBeLessThan(WIDTH / 2);
    expect(Number(canvas?.[2])).toBeLessThan(HEIGHT / 2);
  });

  it('lowers authored blobs exactly: static positions, threshold ramp, fill', () => {
    const graphic = goo({ color: '#9298FB', blobs: [{ x: 0.5, y: 0.5, r: 0.1 }] });
    const plan = gooPlan(graphic as FxGraphicOf<'goo'>, { x: 0, y: 0, w: WIDTH, h: HEIGHT }, { at: 0, end: 2.4 });

    expect(plan.blobs).toHaveLength(1);
    expect(plan.radius).toBe(27);
    expect(graphText(graphic)).toBe(
      'format=yuv420p,split=2[fx0_m][fx0_r0];' +
        '[fx0_r0]trim=end=2.6,crop=62:62:208:104[fx0_r];' +
        '[0:v]format=rgba,fps=30,trim=start=0:end=2.6[fx0_blob_0];' +
        '[fx0_blob_0]scale=146:146[fx0_b0];' +
        'color=c=black:s=62x62:r=30:d=2.6,setpts=PTS+0/TB,format=yuv420p[fx0_c0];' +
        "[fx0_c0][fx0_b0]overlay=x='32-overlay_w/2':y='31-overlay_h/2'[fx0_c1];" +
        "[fx0_c1]lutyuv=y='255*clip((val-125.5)/5.6+0.5,0,1)',format=gray[fx0_k];" +
        'color=c=#9298FB:s=62x62:r=30:d=2.6,setpts=PTS+0/TB[fx0_f];' +
        '[fx0_f][fx0_k]alphamerge[fx0_goo];' +
        "[fx0_r][fx0_goo]overlay=x='0':y='0'[fx0_o0];" +
        "[fx0_m][fx0_o0]overlay=208:104:eof_action=pass:enable='between(t,0,2.6)'"
    );
  });

  it('uses on-device filters only, and is deterministic', () => {
    const graph = graphText(goo({ seed: 3 }));
    const filters = new Set([...graph.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)].map((m) => m[1]));

    for (const filter of filters) expect(DEVICE_FILTERS.has(filter), filter).toBe(true);
    expect(graph).toBe(graphText(goo({ seed: 3 })));
    expect(graph).not.toBe(graphText(goo({ seed: 4 })));
  });

  it('turns into a still blob that fades in and out under reduced motion', () => {
    const inputs: string[] = [];
    const filters = lower(goo(), inputs, 0);
    const keys = inputs.map((entry) => entry.slice(0, entry.indexOf('=')));
    const graph = renderFilterGraph(filters[0].graph ?? [], filterText, (key) => keys.indexOf(key));

    expect(graph).toContain('fade=t=in');
    expect(graph).toContain('fade=t=out');
    expect(graph).not.toContain('eval=frame');
    expect(graph.match(/overlay=x='/g)).toHaveLength(2);
  });
});

// Real FFmpeg: blobs on a dark frame, measured on the mask (luma well above the background).
describe.skipIf(!hasFfmpeg())('goo on real frames', () => {
  beforeAll(() => {
    fs.mkdirSync(dir, { recursive: true });
  });

  const BASE = `color=c=0x141416:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${SECTION},format=yuv420p`;

  function frame(graphic: FxGraphic, name: string, at = 1): Buffer {
    const inputs: string[] = [];
    const graph = graphText(graphic, inputs);
    const files = inputs.map((entry, i) => {
      const file = path.join(dir, `${name}-${i}.png`);

      fs.writeFileSync(file, spritePng(parseSpriteUrl(entry.slice(entry.indexOf('=') + 1)) as SpriteSpec));

      return file;
    });
    const raw = execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        ...files.flatMap((file) => ['-loop', '1', '-i', file]),
        '-filter_complex',
        `${BASE},${graph},trim=start_frame=${Math.round(at * FPS)},setpts=PTS-STARTPTS`,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-',
      ],
      { maxBuffer: 1 << 28 }
    );

    return raw.subarray(0, WIDTH * HEIGHT);
  }

  // 4-connected components of the pixels brighter than mid-way between the background and the fill.
  function components(luma: Buffer): number {
    const seen = new Uint8Array(WIDTH * HEIGHT);
    let count = 0;

    for (let start = 0; start < luma.length; start++) {
      if (seen[start] || luma[start] < 80) continue;

      count++;
      const stack = [start];
      seen[start] = 1;

      while (stack.length > 0) {
        const at = stack.pop() as number;
        const [x, y] = [at % WIDTH, Math.floor(at / WIDTH)];
        const next = [x > 0 ? at - 1 : -1, x < WIDTH - 1 ? at + 1 : -1, y > 0 ? at - WIDTH : -1, at + WIDTH];

        for (const n of next) {
          if (n < 0 || n >= luma.length || seen[n] || luma[n] < 80) continue;

          seen[n] = 1;
          stack.push(n);
        }
      }
    }

    return count;
  }

  // Two blobs of radius 0.12 × 270 ≈ 32 px: as discs they would touch at 65 px apart.
  const pair = (distance: number): FxGraphic =>
    goo({
      color: '#9298FB',
      duration: 2,
      blobs: [
        { x: 0.5 - distance / 2 / WIDTH, y: 0.5, r: 0.12 },
        { x: 0.5 + distance / 2 / WIDTH, y: 0.5, r: 0.12 },
      ],
    });

  it('fuses two blobs closer than the goo reach into one shape, keeps them apart beyond it', () => {
    const near = frame(pair(74), 'near');
    const far = frame(pair(120), 'far');

    // 74 px apart: discs would leave a 9 px gap, the goo bridges it with a neck.
    expect(components(near)).toBe(1);
    expect(components(far)).toBe(2);
    // The neck is narrower than the blobs: the middle column is lit over fewer rows than a blob centre.
    const lit = (luma: Buffer, x: number): number =>
      Array.from({ length: HEIGHT }, (_, y) => luma[y * WIDTH + x]).filter((value) => value >= 80).length;

    expect(lit(near, WIDTH / 2)).toBeGreaterThan(0);
    expect(lit(near, WIDTH / 2)).toBeLessThan(lit(near, Math.round(WIDTH / 2 - 37)));
  }, 60000);

  it('anti-aliases the edge: intermediate values between the background and the fill', () => {
    const luma = frame(pair(120), 'edge');
    const background = luma[0];
    const fill = Math.max(...luma);
    const between = luma.filter((value) => value > background + 8 && value < fill - 8).length;

    expect(fill - background).toBeGreaterThan(80);
    expect(between).toBeGreaterThan(40);
    // ...but a narrow ramp, not a blur: well under the blobs' area.
    expect(between).toBeLessThan(2 * Math.PI * 32 * 6);
  }, 60000);

  it('splits and merges back: one shape, then several, then one again', () => {
    const graphic = goo({ color: '#9298FB', duration: 2, droplets: 2, spread: 0.35, angle: 0 });
    const counts = [0.15, 0.85, 1.75].map((at) => components(frame(graphic, `split-${at}`, at)));

    expect(counts[0]).toBe(1);
    expect(counts[1]).toBeGreaterThanOrEqual(2);
    expect(counts[2]).toBe(1);
  }, 120000);
});
