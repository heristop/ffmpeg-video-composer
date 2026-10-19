import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { encodePng } from '@/editor/presets/png-encode';
import { TemplateValidator } from '@/services/TemplateValidator';
import { testBuildDir } from './fixtures/build-dir';

// Masks on real frames over moving footage (testsrc2): the masked layer shows only inside its mask, keeps its
// own transparency there, and leaves the footage untouched everywhere else.

const W = 640;
const H = 360;
const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = testBuildDir('mask-render');
const media = path.join(buildDir, 'fixtures');
const footage = path.join(media, 'footage.mp4');
const card = path.join(media, 'card.png');

const config = {
  buildDir,
  assetsDir: path.resolve(here, '../../leclap-creative-kit/src/library'),
  currentLocale: 'en',
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: `${W}:${H}` },
} as unknown as ProjectConfig;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CARD: Box = { x: 220, y: 130, w: 200, h: 100 };
const SLOT: Box = { x: 270, y: 130, w: 100, h: 100 };
const AT = [5, 15, 25];

function png(w: number, h: number, pixel: (x: number, y: number) => readonly number[]): Uint8Array {
  const data = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(pixel(x, y), (y * w + x) * 4);

  return encodePng({ width: w, height: h, channels: 4, data });
}

// Mid grey, so a leak shows on both sides of the slot (testsrc2 is light at the card and has dark bars, so
// the card differs from it by over the 40-level threshold either way), with 20 px transparent corners: a
// rounded card's own alpha.
function cardPixel(x: number, y: number): readonly number[] {
  return (x < 20 || x >= 180) && (y < 20 || y >= 80) ? [0, 0, 0, 0] : [128, 128, 128, 255];
}

function layer(name: string, url: string, box: Box, options: Record<string, unknown> = {}) {
  return {
    name,
    type: 'image',
    url,
    options: { position: `${box.x}:${box.y}`, scale: `${box.w}:${box.h}`, ...options },
  };
}

function template(inputs: unknown[], options: Record<string, unknown> = {}): TemplateDescriptor {
  const section = {
    name: 'masked',
    type: 'video',
    options: { duration: 1, videoUrl: footage, muteSection: false, ...options },
  };

  return {
    global: { orientation: 'landscape', musicEnabled: false, fps: 30 },
    sections: [inputs.length > 0 ? { ...section, inputs } : section],
  } as unknown as TemplateDescriptor;
}

async function frames(d: TemplateDescriptor, skipValidation = false): Promise<Buffer[]> {
  const output = (await compile(skipValidation ? { ...config, skipValidation } : config, d)) as string;
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {
    maxBuffer: 1 << 29,
  });

  return Array.from({ length: raw.length / (W * H) }, (_, i) => raw.subarray(i * W * H, (i + 1) * W * H));
}

function inBox(box: Box, x: number, y: number, margin: number): boolean {
  return x >= box.x - margin && x < box.x + box.w + margin && y >= box.y - margin && y < box.y + box.h + margin;
}

// Pixels differing by more than 40 grey levels, inside `box` shrunk by 3 px (or outside it grown by 3 px).
function changed(a: Buffer, b: Buffer, box: Box, outside = false): number {
  let count = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const counted = outside ? !inBox(box, x, y, 3) : inBox(box, x, y, -3);

      if (counted && Math.abs(a[y * W + x] - b[y * W + x]) > 40) count++;
    }
  }

  return count;
}

// Mean grey level inside a box.
function meanIn(frame: Buffer, box: Box): number {
  let sum = 0;

  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) sum += frame[y * W + x];

  return sum / (box.w * box.h);
}

let bare: Buffer[] = [];
let free: Buffer[] = [];

beforeAll(async () => {
  fs.mkdirSync(media, { recursive: true });
  const sources = ['-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=30:d=2`, '-f', 'lavfi', '-i', 'sine=d=2'];
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...sources, '-pix_fmt', 'yuv420p', '-shortest', footage]);
  const clipSource = ['-f', 'lavfi', '-i', 'color=c=gray:s=200x100:r=30:d=2'];
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...clipSource, '-pix_fmt', 'yuv420p', path.join(media, 'clip.mp4')]);
  fs.writeFileSync(card, png(200, 100, cardPixel));
  fs.writeFileSync(
    path.join(media, 'hole.png'),
    png(100, 100, (x) => (x < 50 ? [255, 255, 255, 255] : [255, 255, 255, 0]))
  );
  fs.writeFileSync(
    path.join(media, 'hole-luma.png'),
    png(100, 100, (x) => (x < 50 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  );
  fs.writeFileSync(
    path.join(media, 'word.png'),
    png(W, H, (x, y) => (x >= 100 && x < 300 && y >= 100 && y < 200 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  );
  bare = await frames(template([]));
  free = await frames(template([layer('card', card, CARD)]));
}, 600_000);

afterAll(() => {
  fs.rmSync(buildDir, { recursive: true, force: true });
});

describe('layer shape masks on real frames', () => {
  it('validates cleanly', () => {
    const masked = template([layer('card', card, CARD, { mask: { shape: { type: 'rect', ...SLOT } } })]);

    expect(new TemplateValidator().validateTemplate(masked).errors ?? []).toEqual([]);
  });

  it('shows the layer only inside its mask, whole there', async () => {
    const masked = await frames(template([layer('card', card, CARD, { mask: { shape: { type: 'rect', ...SLOT } } })]));

    for (const k of AT) {
      expect(changed(free[k], bare[k], CARD), 'the card is drawn at all').toBeGreaterThan(1000);
      expect(changed(masked[k], bare[k], SLOT, true), `outside, frame ${k}`).toBe(0);
      expect(changed(masked[k], free[k], SLOT), `inside, frame ${k}`).toBe(0);
    }
  }, 600_000);

  // The mask multiplies coverage; the card's transparent corners stay transparent.
  it("keeps the layer's own transparent corners inside a wider mask", async () => {
    const wide = { shape: { type: 'rect', x: 200, y: 110, w: 240, h: 140 } };
    const masked = await frames(template([layer('card', card, CARD, { mask: wide })]));
    const corner: Box = { x: 220, y: 130, w: 20, h: 20 };

    for (const k of AT) {
      expect(changed(masked[k], bare[k], corner), `corner, frame ${k}`).toBe(0);
      expect(changed(masked[k], free[k], CARD), `card, frame ${k}`).toBe(0);
    }
  }, 600_000);

  it('inverts: the footage inside the shape, the layer outside it', async () => {
    const masked = await frames(
      template([layer('card', card, CARD, { mask: { shape: { type: 'rect', ...SLOT }, invert: true } })])
    );
    const left: Box = { x: 240, y: 150, w: 26, h: 60 };

    for (const k of AT) {
      expect(changed(masked[k], bare[k], SLOT), `slot, frame ${k}`).toBe(0);
      expect(changed(masked[k], free[k], left), `left of the slot, frame ${k}`).toBe(0);
      expect(changed(free[k], bare[k], left)).toBeGreaterThan(200);
    }
  }, 600_000);

  it('moves the mask with its tracks: the layer hidden while the slot is away, whole once it lands', async () => {
    const mask = {
      shape: { type: 'rect', ...SLOT },
      animate: {
        x: [
          { t: 0, v: -200 },
          { t: 0.5, v: 0 },
        ],
      },
    };
    const masked = await frames(template([layer('card', card, CARD, { mask })]));

    expect(changed(masked[0], bare[0], CARD)).toBe(0);
    expect(changed(masked[25], bare[25], SLOT, true)).toBe(0);
    expect(changed(masked[25], free[25], SLOT)).toBe(0);
  }, 600_000);
});

const HOLE: Box = { x: 270, y: 130, w: 100, h: 100 };

describe('track mattes on real frames', () => {
  const LEFT: Box = { x: 270, y: 130, w: 50, h: 100 };

  it.each([
    ['alpha', 'hole.png'],
    ['luma', 'hole-luma.png'],
  ])(
    'shows the layer through the %s of its matte and never draws the matte',
    async (mode, file) => {
      const inputs = [
        layer('card', card, CARD, { mask: { layer: 'hole', mode } }),
        layer('hole', path.join(media, file), HOLE),
      ];

      expect(new TemplateValidator().validateTemplate(template(inputs)).errors ?? []).toEqual([]);

      const masked = await frames(template(inputs));

      for (const k of AT) {
        expect(changed(masked[k], bare[k], LEFT, true), `outside, frame ${k}`).toBe(0);
        expect(changed(masked[k], free[k], LEFT), `inside, frame ${k}`).toBe(0);
      }
    },
    600_000
  );

  it('hides the layer until its matte appears', async () => {
    const inputs = [
      layer('card', card, CARD, { mask: { layer: 'hole' } }),
      layer('hole', path.join(media, 'hole.png'), HOLE, { start: 0.5 }),
    ];
    const masked = await frames(template(inputs));

    expect(changed(masked[5], bare[5], CARD)).toBe(0);
    expect(changed(masked[25], free[25], LEFT)).toBe(0);
  }, 600_000);

  it('inverts: the layer through the part of the matte that is not covered', async () => {
    const inputs = [
      layer('card', card, CARD, { mask: { layer: 'hole', invert: true } }),
      layer('hole', path.join(media, 'hole.png'), HOLE),
    ];
    const masked = await frames(template(inputs));
    const right: Box = { x: 320, y: 130, w: 50, h: 100 };

    for (const k of AT) {
      expect(changed(masked[k], bare[k], LEFT), `covered half, frame ${k}`).toBe(0);
      expect(changed(masked[k], free[k], right), `open half, frame ${k}`).toBe(0);
    }
  }, 600_000);

  // An animation input with a video url is drawn as plain media, not as a layer: no matte leg may be registered
  // for it (the unconnected leg aborted the graph), and the mask reader draws unmasked, whole.
  it('draws a reader whose matte is plain media unmasked, and FFmpeg accepts the graph', async () => {
    const inputs = [
      layer('card', card, CARD, { mask: { layer: 'hole' } }),
      { name: 'hole', type: 'animation', url: path.join(media, 'clip.mp4'), options: { position: '270:130' } },
    ];
    const masked = await frames(template(inputs));

    expect(masked.length).toBeGreaterThan(0);

    for (const k of AT) {
      expect(changed(free[k], bare[k], CARD), 'the card is drawn at all').toBeGreaterThan(1000);
      expect(changed(masked[k], free[k], CARD), `card unmasked, frame ${k}`).toBe(0);
    }
  }, 600_000);

  // The reader is the .mp4 animation (plain media, not a layer): its mask is ignored, the image it names is not
  // registered as a matte either, so it draws as an ordinary layer.
  it('draws an .mp4 animation reader plainly, and the image it names as an ordinary layer', async () => {
    const inputs = [
      {
        name: 'clip',
        type: 'animation',
        url: path.join(media, 'clip.mp4'),
        options: { position: '400:20', mask: { layer: 'card' } },
      },
      layer('card', card, CARD),
    ];
    const masked = await frames(template(inputs));

    for (const k of AT) {
      expect(changed(masked[k], free[k], CARD), `card drawn, frame ${k}`).toBe(0);
    }
  }, 600_000);

  // Under skipValidation a matte that is itself a matte (self, chain, cycle) used to leave a registered leg
  // unconnected and abort the graph: such a reader draws plain instead.
  it.each([
    ['its own matte', [['card', 'card']]],
    [
      'a chain',
      [
        ['card', 'hole'],
        ['hole', 'word'],
      ],
    ],
    [
      'a cycle',
      [
        ['card', 'hole'],
        ['hole', 'card'],
      ],
    ],
  ] as const)(
    'accepts a graph where a layer is %s',
    async (_name, links) => {
      const mask = (name: string) => links.find(([reader]) => reader === name)?.[1];
      const inputs = [
        layer('card', card, CARD, mask('card') ? { mask: { layer: mask('card') } } : {}),
        layer('hole', path.join(media, 'hole.png'), HOLE, mask('hole') ? { mask: { layer: mask('hole') } } : {}),
        layer('word', path.join(media, 'hole.png'), { x: 10, y: 10, w: 50, h: 50 }),
      ];
      const rendered = await frames(template(inputs), true);

      expect(rendered.length).toBeGreaterThan(0);
    },
    600_000
  );
});

describe('section masks on real frames', () => {
  it('shows the clip inside a shape and the background outside, with layers drawn on top', async () => {
    const mask = { shape: { type: 'ellipse', cx: 320, cy: 180, rx: 120, ry: 90 }, background: '#000000' };
    const d = template([layer('card', card, { x: 420, y: 240, w: 200, h: 100 })], { mask });

    expect(new TemplateValidator().validateTemplate(d).errors ?? []).toEqual([]);

    const masked = await frames(d);

    for (const k of AT) {
      expect(changed(masked[k], bare[k], { x: 280, y: 150, w: 80, h: 60 }), `centre, frame ${k}`).toBe(0);
      expect(meanIn(masked[k], { x: 0, y: 0, w: 120, h: 80 }), `corner, frame ${k}`).toBeLessThan(25);
      expect(meanIn(masked[k], { x: 460, y: 260, w: 120, h: 60 }), `card, frame ${k}`).toBeGreaterThan(100);
    }
  }, 600_000);

  it('shows the clip through a luma track matte layer, which is not drawn', async () => {
    const d = template([layer('word', path.join(media, 'word.png'), { x: 0, y: 0, w: W, h: H })], {
      mask: { layer: 'word', mode: 'luma' },
    });
    const masked = await frames(d);
    const word: Box = { x: 100, y: 100, w: 200, h: 100 };

    for (const k of AT) {
      expect(changed(masked[k], bare[k], word), `inside the word, frame ${k}`).toBe(0);
      expect(meanIn(masked[k], { x: 400, y: 220, w: 200, h: 100 }), `outside, frame ${k}`).toBeLessThan(25);
    }
  }, 600_000);

  // The matte composites over the gradient layers already drawn, not over a rebuilt background (the schema only
  // lets color_background carry layers, so this is a library caller that skips validation).
  it('masks the gradient layers drawn before it instead of erasing them', async () => {
    const white = { gradient: { from: '#ffffff', to: '#ffffff' } };
    const d = template([layer('word', path.join(media, 'word.png'), { x: 0, y: 0, w: W, h: H })], {
      mask: { layer: 'word', mode: 'luma' },
      layers: [white],
    });
    const masked = await frames(d, true);

    for (const k of AT) {
      expect(
        meanIn(masked[k], { x: 120, y: 110, w: 160, h: 80 }),
        `gradient inside the word, frame ${k}`
      ).toBeGreaterThan(240);
      expect(meanIn(masked[k], { x: 400, y: 220, w: 200, h: 100 }), `outside, frame ${k}`).toBeLessThan(25);
    }
  }, 600_000);
});
