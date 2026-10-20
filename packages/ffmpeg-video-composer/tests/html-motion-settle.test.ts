import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { applyMotionStates, motionTargets } from '@/core/html/element-motion';
import { HTML_LAYER_DENSITY, prepareHtmlLayer } from '@/core/html/html-layer';
import { planMotionFrames, type ElementMotionMap, type MotionFramePlan } from '@/core/html/motion-frames';
import { createNodeHtmlRasteriser } from '@/services/html-node/html-rasteriser-node';

// An animated card's elements settle where they rest. Satori writes every transform as an SVG matrix
// rounded to two decimals, while the shift that keeps a scaled element centred on its own box is worked
// out from the exact scale: a spring tail at scale 1.006 drew its chip a pixel off its centre, then back.

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(here, '../../leclap-creative-kit/src/library/fonts');

const CHIPS = {
  html:
    '<div class="card"><div class="pad"></div><div class="chips"><span class="chip" data-motion="chip">3 rooms</span>' +
    '<span class="chip" data-motion="chip">Balcony</span></div></div>',
  css:
    '.card { display: flex; flex-direction: column; width: 100%; height: 100%; padding: 32px; background: #f4efe6 } ' +
    '.pad { height: 160px } .chips { display: flex; gap: 60px } ' +
    '.chip { padding: 8px 16px; border-radius: 12px; background: #141416; color: #f4efe6; font: 500 20px Rubik }',
  width: 640,
  height: 300,
};

const SPRING_CHIPS: ElementMotionMap = {
  chip: {
    scale: [
      { t: 1.0, v: 0.6 },
      { t: 1.4, v: 1, ease: 'spring(300, 14)' },
    ],
    stagger: 0.12,
  },
};

function plan(motion: ElementMotionMap): MotionFramePlan {
  const layer = prepareHtmlLayer(CHIPS, 'Rubik');
  const result = planMotionFrames(motionTargets(layer.element), motion, 30);

  if (result.kind !== 'plan') throw new Error(`no plan: ${result.kind}`);

  return result.plan;
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];

  if (pa <= pb && pa <= pc) return left;

  return pb <= pc ? up : upLeft;
}

// The decoded RGBA rows of a resvg PNG (8-bit RGBA, non-interlaced), unfiltered.
function decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const [width, height] = [view.getUint32(16), view.getUint32(20)];
  const chunks: Uint8Array[] = [];

  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCodePoint(...png.subarray(at + 4, at + 8));

    if (type === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + length));

    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rgba = new Uint8Array(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));

    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      const predictors = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)];

      rgba[y * stride + x] = (line[x] + predictors[filter]) & 0xff;
    }
  }

  return { width, height, rgba };
}

// The centre of the first chip's dark box, in output pixels.
function chipCentre(png: Uint8Array): { x: number; y: number } {
  const { width, rgba } = decodePng(png);
  let [sum, sx, sy] = [0, 0, 0];

  for (let y = 300; y < 600; y++) {
    for (let x = 0; x < 300; x++) {
      const at = (y * width + x) * 4;
      const ink = 255 - (rgba[at] + rgba[at + 1] + rgba[at + 2]) / 3;

      if (ink < 128) continue;

      sum += 1;
      sx += x;
      sy += y;
    }
  }

  return { x: sx / sum / HTML_LAYER_DENSITY, y: sy / sum / HTML_LAYER_DENSITY };
}

describe('animated card settle', () => {
  it('plans scales on the grid Satori draws them at, ending exactly at rest', () => {
    const frames = plan(SPRING_CHIPS).frames;

    for (const frame of frames) {
      for (const state of frame.states) expect(Number.isInteger(Math.round(state.scale * 1e6) / 1e4)).toBe(true);
    }

    expect(frames.at(-1)?.states.map((state) => state.scale)).toEqual([1, 1]);
  });

  it('holds a turn at rest once it is closer to it than Satori can draw', () => {
    const turn: ElementMotionMap = {
      chip: {
        rotate: [
          { t: 0, v: -12 },
          { t: 0.8, v: 0, ease: 'spring(300, 14)' },
        ],
      },
    };
    const angles = plan(turn).frames.map((frame) => frame.states[0].rotate);
    const firstNear = angles.findIndex((angle, i) => angles.slice(i).every((later) => Math.abs(later) < 0.29));

    expect(Math.min(...angles)).toBeLessThan(-6);
    expect(
      angles.slice(firstNear).every((angle) => angle === 0),
      angles.join(' ')
    ).toBe(true);
  });

  it('keeps a springing chip centred on its own box, frame after frame', async () => {
    const layer = prepareHtmlLayer(CHIPS, 'Rubik');
    const fonts = layer.faces.map((face) => ({
      ...face,
      data: new Uint8Array(fs.readFileSync(path.join(fontsDir, face.file))),
    }));
    const rasteriser = createNodeHtmlRasteriser();
    const draw = async (states: MotionFramePlan['frames'][number]['states']) =>
      chipCentre(
        (
          await rasteriser.render({
            element: applyMotionStates(layer.element, states),
            width: CHIPS.width,
            height: CHIPS.height,
            density: HTML_LAYER_DENSITY,
            fonts,
          })
        ).png
      );
    const frames = plan(SPRING_CHIPS).frames.filter((frame) => frame.states[0].scale > 0.95);
    const rest = await draw(frames.at(-1)?.states ?? []);
    const drift: number[] = [];

    for (const frame of frames) {
      const centre = await draw(frame.states);

      drift.push(Math.max(Math.abs(centre.x - rest.x), Math.abs(centre.y - rest.y)));
    }

    expect(Math.max(...drift), drift.map((d) => d.toFixed(2)).join(' ')).toBeLessThan(0.25);
  }, 60_000);
});
