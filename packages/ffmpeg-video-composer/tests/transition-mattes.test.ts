import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGlyphOutlines } from '@/core/glyph-outline';
import { parseFontMetrics } from '@/core/font-metrics';
import { coverScale, coverage, fieldLevel, revealField, shapeOutline, signedArea } from '@/core/motion/radial-matte';
import { boundaryMatte, counterOf } from '@/core/motion/transition-mattes';
import { stageTransitionMattes, type MatteIO } from '@/editor/utils/matte-staging';

// The compile-time mattes of the shaped transitions: glyph outlines, a letter's counter, shape fields.

const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.resolve(here, '../../leclap-creative-kit/src/library/fonts');
const archivo = new Uint8Array(fs.readFileSync(path.join(FONTS, 'ArchivoBlack.ttf')));

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

describe('glyph outlines', () => {
  it('reads the contours of a TrueType glyph: an O is two rings, a Z one', () => {
    const font = parseGlyphOutlines(archivo);

    expect(font?.unitsPerEm).toBe(1000);
    expect(font?.contours('O'.codePointAt(0) as number)).toHaveLength(2);
    expect(font?.contours('Z'.codePointAt(0) as number)).toHaveLength(1);
    expect(font?.contours(0x4e00)).toBeNull();
    expect(parseGlyphOutlines(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("finds the O's counter: the inner ring, inside the outer one", () => {
    const font = parseGlyphOutlines(archivo);
    const contours = font?.contours('O'.codePointAt(0) as number) ?? [];
    const counter = counterOf(contours);
    const [outer, inner] = [...contours].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));

    expect(counter).toBe(inner);
    expect(Math.abs(signedArea(inner))).toBeLessThan(Math.abs(signedArea(outer)));
    expect(counterOf(font?.contours('Z'.codePointAt(0) as number) ?? [])).toBeNull();
  });
});

describe('shape fields', () => {
  it('codes the scale that reaches each pixel in 16 bits: 0 at the centre, the top level at the last corner', () => {
    const outline = shapeOutline('circle', { x: 40, y: 30 }, 1);
    const field = revealField(outline, 80, 60);

    expect(field.depth).toBe(16);
    expect(fieldLevel(field, 30 * 80 + 40)).toBeLessThanOrEqual(4 * 257);
    expect(fieldLevel(field, 0)).toBeGreaterThan(250 * 257);
    expect(coverScale(outline, 80, 60)).toBeCloseTo(50, 0);
  });

  it('a star field reaches its points before its valleys', () => {
    const outline = shapeOutline('star', { x: 100, y: 100 }, 1);
    const field = revealField(outline, 200, 200);
    // 40 px up (a point) vs 40 px along the valley between the two top points (36° off).
    const up = fieldLevel(field, 60 * 200 + 100);
    const valley = fieldLevel(
      field,
      Math.round(100 - 40 * Math.cos(Math.PI / 5)) * 200 + Math.round(100 + 40 * Math.sin(Math.PI / 5))
    );

    expect(valley).toBeGreaterThan(1.8 * up);
  });

  it('fills polygons anti-aliased', () => {
    const square = [
      { x: 2, y: 2 },
      { x: 6.5, y: 2 },
      { x: 6.5, y: 6 },
      { x: 2, y: 6 },
    ];
    const image = coverage([square], 8, 8);

    expect(image.data[3 * 8 + 3]).toBe(255);
    expect(image.data[3 * 8 + 6]).toBe(128);
    expect(image.data[0]).toBe(0);
  });
});

describe('boundary mattes', () => {
  const frame = { width: 640, height: 360 };

  it('a circle iris and the plain transitions need none', () => {
    expect(boundaryMatte({ type: 'iris' }, frame).matte).toBeNull();
    expect(boundaryMatte({ type: 'iris', shape: 'circle' }, frame).matte).toBeNull();
    expect(boundaryMatte({ type: 'zoom-through' }, frame).matte).toBeNull();
  });

  it('a star iris reads a half-size field around its origin', () => {
    const result = boundaryMatte({ type: 'iris', shape: 'star', origin: { x: 0.25, y: 0.5 } }, frame);

    expect(result.matte?.centre).toEqual({ x: 80, y: 90 });
    expect(result.matte?.name).toMatch(/^iris-star-[0-9a-f]{8}\.png$/);
    expect(result.matte?.png().subarray(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(boundaryMatte({ type: 'iris', shape: 'star', origin: { x: 0.25, y: 0.5 } }, frame).matte?.name).toBe(
      result.matte?.name
    );
  });

  it("a zoom-through window: a shape, or a letter's counter laid out like the kinetic block", () => {
    const shape = boundaryMatte(
      { type: 'zoom-through', through: { shape: 'heart', size: 120, x: 200, y: 150 } },
      frame
    );

    expect(shape.matte?.centre).toEqual({ x: 200, y: 150 });
    expect(shape.matte?.scale).toBeGreaterThan(5);

    const font = parseGlyphOutlines(archivo);
    const text = boundaryMatte(
      { type: 'zoom-through', through: { text: 'ZOOM', font: 'archivo-black', size: 120 } },
      frame,
      font
    );

    // The first O: right of the frame centre's left half, on the block's vertical centre.
    expect(text.matte?.centre.x).toBeGreaterThan(220);
    expect(text.matte?.centre.x).toBeLessThan(320);
    expect(text.matte?.centre.y).toBeGreaterThan(150);
    expect(text.matte?.centre.y).toBeLessThan(210);

    const second = boundaryMatte(
      { type: 'zoom-through', through: { text: 'ZOOM', font: 'archivo-black', size: 120, glyph: 2 } },
      frame,
      font
    );

    expect((second.matte?.centre.x ?? 0) - (text.matte?.centre.x ?? 0)).toBeGreaterThan(60);
  });

  it('explains a window it cannot draw', () => {
    const font = parseGlyphOutlines(archivo);

    expect(
      boundaryMatte({ type: 'zoom-through', through: { text: 'ZZZ', font: 'archivo-black' } }, frame, font)
    ).toEqual({
      matte: null,
      reason: 'no character has a counter',
    });
    expect(boundaryMatte({ type: 'zoom-through', through: { text: 'O' } }, frame, null).matte).toBeNull();
    expect(
      boundaryMatte({ type: 'zoom-through', through: { shape: 'circle', size: 2, x: 0, y: 0 } }, frame).matte
    ).toBeNull();
  });

  it('stages the mattes, warns and skips the ones it cannot draw', async () => {
    const written: string[] = [];
    const warnings: string[] = [];
    const staged = await stageTransitionMattes(
      [{ type: 'iris', shape: 'heart' }, { type: 'push-left' }, { type: 'zoom-through', through: { text: 'O' } }],
      frame,
      {
        fs: {
          getBuildPath: async (dir) => `/build/${dir}`,
          getAssetsDir: () => undefined,
          readFile: async () => {
            throw new Error('no such font');
          },
          writeFile: async (file) => {
            written.push(file);
          },
        },
        dir: '/build',
        logger: { warn: (message) => warnings.push(message) },
      }
    );

    expect(staged.map((matte) => matte.k)).toEqual([0]);
    expect(written).toEqual([staged[0].path]);
    expect(staged[0].path).toMatch(/^\/build\/iris-heart-/);
    expect(warnings).toEqual([
      '[Transitions] zoom-through at boundary 2: its font could not be read; rendered without it',
    ]);
  });
});

// A copy of Archivo Black whose glyf table points past the end of the file: it parses, its glyphs throw.
function brokenGlyf(): Uint8Array {
  const bytes = archivo.slice();
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + 16 * i;

    if (String.fromCodePoint(...bytes.subarray(record, record + 4)) === 'glyf') {
      view.setUint32(record + 8, bytes.length - 4);
    }
  }

  return bytes;
}

function stagingIO(readFile: (file: string) => Promise<Uint8Array>, warnings: string[]): MatteIO {
  return {
    fs: {
      getBuildPath: async (dir: string) => `/build/${dir}`,
      getAssetsDir: () => '/assets/fonts',
      readFile,
      writeFile: async () => undefined,
    },
    dir: '/build',
    logger: { warn: (message: string) => warnings.push(message) },
  };
}

describe('matte staging: bundled fonts, safe reads, shared geometry', () => {
  const frame = { width: 640, height: 360 };

  it('never reads a window font that is not bundled, and falls back', async () => {
    const reads: string[] = [];
    const warnings: string[] = [];
    const io = stagingIO(async (file) => {
      reads.push(file);

      return archivo;
    }, warnings);
    const fonts = ['../../../../etc/passwd', '/dev/zero', 'Custom.ttf', 'not-a-font-id'];
    const staged = await stageTransitionMattes(
      fonts.map((font) => ({ type: 'zoom-through', through: { text: 'O', font } })),
      frame,
      io
    );

    expect(reads).toEqual([]);
    expect(staged).toEqual([]);
    expect(warnings).toHaveLength(fonts.length);
  });

  it('reads a bundled font by id or by file', async () => {
    const reads: string[] = [];
    const io = stagingIO(async (file) => {
      reads.push(file);

      return archivo;
    }, []);
    const staged = await stageTransitionMattes(
      [
        { type: 'zoom-through', through: { text: 'O', font: 'archivo-black', size: 200 } },
        { type: 'zoom-through', through: { text: 'O', font: 'ArchivoBlack.ttf', size: 200 } },
      ],
      frame,
      io
    );

    expect(reads.every((file) => file.endsWith('/ArchivoBlack.ttf'))).toBe(true);
    expect(staged.map((matte) => matte.k)).toEqual([0, 1]);
  });

  it('draws and writes a matte once when several boundaries share its geometry', async () => {
    const written: string[] = [];
    const io = stagingIO(async () => archivo, []);
    io.fs.writeFile = async (file: string) => {
      written.push(file);
    };
    const window = { type: 'zoom-through', through: { shape: 'star', size: 300 } } as const;
    const staged = await stageTransitionMattes(
      [{ type: 'iris', shape: 'heart' }, window, { type: 'iris', shape: 'heart' }, window],
      frame,
      io
    );

    expect(staged.map((matte) => matte.k)).toEqual([0, 1, 2, 3]);
    expect(staged[2].path).toBe(staged[0].path);
    expect(staged[3].path).toBe(staged[1].path);
    expect(written).toHaveLength(2);
  });

  it('a glyph that cannot be read has no contours instead of throwing', () => {
    const font = parseGlyphOutlines(brokenGlyf());

    expect(font).not.toBeNull();
    expect(font?.contours(0x4f)).toBeNull();
  });

  it('a malformed font falls back instead of failing the staging', async () => {
    const warnings: string[] = [];
    const io = stagingIO(async () => brokenGlyf(), warnings);
    const staged = await stageTransitionMattes(
      [{ type: 'zoom-through', through: { text: 'O', font: 'archivo-black', size: 200 } }],
      frame,
      io
    );

    expect(staged).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

// Real FFmpeg: the counter matte of an O sits exactly in the hole drawtext leaves, when the letter is drawn
// where a kinetic block of the same text, font, size, x and y draws it (pen x, baseline 0.8 em below the top).
describe.skipIf(!hasFfmpeg())('counter matte on a drawn letter', () => {
  it('matches the hole of the drawn O', { timeout: 120_000 }, () => {
    const [W, H, size] = [640, 360, 200];
    const font = parseGlyphOutlines(archivo);
    const metrics = parseFontMetrics(archivo);
    const result = boundaryMatte(
      { type: 'zoom-through', through: { text: 'O', font: 'archivo-black', size } },
      { width: W, height: H },
      font
    );
    const advance = ((metrics?.advanceWidth(79) ?? 0) / 1000) * size;
    const top = (H - size * 1.05) / 2;
    const x = W / 2 - advance / 2;
    const fontfile = path.join(FONTS, 'ArchivoBlack.ttf');
    const raw = execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${W}x${H}:d=0.04,drawtext=fontfile=${fontfile}:text=O:fontsize=${size}:fontcolor=white:x=${x}:y=${top + 0.8 * size}-max_glyph_a`,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-',
      ],
      { maxBuffer: 1 << 26 }
    );
    const matte = coverage(
      [counterOf(font?.contours(79) ?? []) ?? []].map((c) =>
        c.map((p) => ({ x: x + (p.x * size) / 1000, y: top + 0.8 * size - (p.y * size) / 1000 }))
      ),
      W,
      H
    );

    expect(result.matte?.centre.x).toBeCloseTo(W / 2, -1);

    // The hole: dark pixels connected to the matte's centre.
    const hole = new Uint8Array(W * H);
    const stack = [Math.round(result.matte?.centre.y ?? 0) * W + Math.round(result.matte?.centre.x ?? 0)];

    while (stack.length > 0) {
      const p = stack.pop() as number;

      if (hole[p] || raw[p] > 128) continue;

      hole[p] = 1;
      stack.push(p + 1, p - 1, p + W, p - W);
    }

    let [both, either] = [0, 0];

    for (let p = 0; p < W * H; p++) {
      const inMatte = matte.data[p] > 128;

      if (inMatte && hole[p]) both++;

      if (inMatte || hole[p]) either++;
    }

    expect(both / either).toBeGreaterThan(0.95);
  });
});
