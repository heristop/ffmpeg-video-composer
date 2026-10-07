import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bandProfile,
  parseSpriteUrl,
  spriteFileName,
  spriteImage,
  spritePng,
  spriteUrl,
  type SpriteSpec,
} from '@/editor/presets/fx-sprites';

const here = path.dirname(fileURLToPath(import.meta.url));

// One spec per sprite kind, at sizes an effect would really ask for.
const SPECS: Record<string, SpriteSpec> = {
  disc: { kind: 'disc', w: 48, h: 48, sigma: 8, color: 'fff8ee' },
  ring: { kind: 'ring', w: 96, h: 96, radius: 36, stroke: 3, halo: 6 },
  star: { kind: 'star', w: 64, h: 64, sigma: 2, flare: 10 },
  stroke: { kind: 'stroke', w: 160, h: 90, radius: 18, stroke: 2 },
  mask: { kind: 'mask', w: 120, h: 80, radius: 16 },
  rect: { kind: 'piece', w: 12, h: 6, shape: 'rect', color: 'ff3366' },
  piece: { kind: 'piece', w: 10, h: 10, shape: 'disc', color: '33ccff' },
  band: { kind: 'band', w: 140, h: 120, width: 36, tilt: 20, bloom: 0.25, peak: 0.32, color: 'fff8ee' },
};

const SHA256: Record<string, string> = {
  disc: '98e6eb9ee40b6d46dd8cebe64d83e3d7182e05292886d30403000a4fb77871df',
  ring: 'a42ea0d29f5f69133173812f2bd449ef7fb0f9cfde3edb239c5b519d66046255',
  star: '71fcb73ea95d381b4df38c2141df8f813b50ad8821a2354ccbb82cbb40bc30f1',
  stroke: '6d281ab8f96c85f3644cc8e4c34b6df24463f51681f254abb8a96facd4f93c7e',
  mask: 'b77dbf858d9df165e0534cd113db37e246ab0fec07741997bcf90e12e65ecbd1',
  rect: '2f973dde0e2c28914810ca179b6f7f398cfa7b62335835f985ffb74f6acce960',
  piece: '3055ae886cb30d1201c7ed5bc26ebadcfeb4a326bd76bddb81c14e773c459454',
  band: 'd93a5d9017d8a8e92e0806837f186ec1eb0b2f4f20e99c297debf30fb84db41d',
};

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function alphaAt(spec: SpriteSpec, x: number, y: number): number {
  const image = spriteImage(spec);

  return image.data[(y * image.width + x) * image.channels + image.channels - 1];
}

describe('fx sprites', () => {
  it('encodes every kind to the same bytes on every run', () => {
    for (const [name, spec] of Object.entries(SPECS)) {
      expect(sha(spritePng(spec)), name).toBe(SHA256[name]);
    }
  });

  it('writes RGBA PNGs, and a grayscale PNG for masks', () => {
    const ihdrColourType = (bytes: Uint8Array): number => bytes[25];

    expect(ihdrColourType(spritePng(SPECS.disc))).toBe(6);
    expect(ihdrColourType(spritePng(SPECS.mask))).toBe(0);
  });

  it('keeps the sprite colour on every pixel (alpha carries the shape)', () => {
    const image = spriteImage(SPECS.disc);

    for (let i = 0; i < image.data.length; i += 4) {
      expect([image.data[i], image.data[i + 1], image.data[i + 2]]).toEqual([0xff, 0xf8, 0xee]);
    }
  });

  it('gives a gaussian disc a bright centre and an invisible edge', () => {
    expect(alphaAt(SPECS.disc, 24, 24)).toBeGreaterThan(245);
    // One sigma out (8 px): exp(-0.5) of the peak.
    expect(alphaAt(SPECS.disc, 32, 24) / 255).toBeCloseTo(Math.exp(-0.5 * (8.5 / 8) ** 2), 1);
    expect(alphaAt(SPECS.disc, 0, 0)).toBe(0);
  });

  it('draws the ring stroke solid, its halo softer and the centre empty', () => {
    expect(alphaAt(SPECS.ring, 48 + 36, 48)).toBe(255);
    const halo = alphaAt(SPECS.ring, 48 + 36 + 6, 48);

    expect(halo).toBeGreaterThan(40);
    expect(halo).toBeLessThan(140);
    expect(alphaAt(SPECS.ring, 48, 48)).toBe(0);
  });

  it('gives a star a core and long thin flares', () => {
    expect(alphaAt(SPECS.star, 32, 32)).toBeGreaterThan(235);
    expect(alphaAt(SPECS.star, 32 + 12, 32)).toBeGreaterThan(alphaAt(SPECS.star, 32 + 12, 32 + 12) + 80);
  });

  it('anti-aliases rounded strokes and masks, with clean straight runs', () => {
    expect(alphaAt(SPECS.stroke, 80, 0)).toBe(255);
    expect(alphaAt(SPECS.stroke, 80, 45)).toBe(0);
    expect(alphaAt(SPECS.stroke, 0, 0)).toBe(0);
    expect(alphaAt(SPECS.mask, 60, 40)).toBe(255);
    expect(alphaAt(SPECS.mask, 0, 0)).toBe(0);
    expect(alphaAt(SPECS.mask, 0, 40)).toBe(255);
    const corner = alphaAt(SPECS.mask, 4, 4);

    expect(corner).toBeGreaterThanOrEqual(0);
    expect(corner).toBeLessThan(255);
  });

  it('fills confetti pieces as rectangles or ellipses', () => {
    expect(alphaAt(SPECS.rect, 0, 0)).toBe(255);
    expect(alphaAt(SPECS.piece, 5, 5)).toBe(255);
    expect(alphaAt(SPECS.piece, 0, 0)).toBe(0);
  });

  it('shapes the sheen band as a gaussian core plus a wider bloom', () => {
    const spec = SPECS.band;
    const peak = bandProfile(0, spec);

    expect(peak).toBeCloseTo(0.32, 6);
    // Core σ = width / 4 = 9 px; bloom σ = 18 px at a quarter of the peak.
    expect(bandProfile(9, spec) / peak).toBeCloseTo(0.75 * Math.exp(-0.5) + 0.25 * Math.exp(-0.125), 6);
    expect(bandProfile(36, spec) / peak).toBeLessThan(0.04);
    expect(alphaAt(spec, 70, 60)).toBe(
      Math.round(255 * bandProfile(0.5 * Math.cos(Math.PI / 9) + 0.5 * Math.sin(Math.PI / 9), spec))
    );
    expect(alphaAt(spec, 0, 60)).toBe(0);
  });

  it('offers soft and twin band profiles that fade out by ±width', () => {
    const soft = { width: 40, peak: 1, profile: 'soft' as const };
    const twin = { width: 40, peak: 1, profile: 'twin' as const };

    expect(bandProfile(0, soft)).toBe(1);
    expect(bandProfile(40 / 3, soft)).toBeCloseTo(Math.exp(-0.5), 6);
    expect(bandProfile(14, twin)).toBeCloseTo(1, 6);
    expect(bandProfile(0, twin)).toBeLessThan(0.1);

    for (const spec of [soft, twin, { width: 40, peak: 1 }]) expect(bandProfile(40, spec)).toBeLessThan(0.04);

    const url = spriteUrl({ ...SPECS.band, profile: 'twin' });

    expect(url).toContain('profile=twin');
    expect(parseSpriteUrl(url)?.profile).toBe('twin');
    expect(parseSpriteUrl(url.replace('twin', 'blob'))).toBeNull();
  });

  it('round-trips specs through canonical sprite: URLs and names files deterministically', () => {
    for (const spec of Object.values(SPECS)) {
      const url = spriteUrl(spec);

      expect(url.startsWith('sprite:kind=')).toBe(true);
      expect(spriteUrl(parseSpriteUrl(url) as SpriteSpec)).toBe(url);
      expect(spriteFileName(spec)).toMatch(/^sprite-[a-z]+-[0-9a-f]{8}\.png$/);
    }

    expect(spriteFileName(SPECS.disc)).not.toBe(spriteFileName({ ...SPECS.disc, sigma: 9 }));
  });

  it('rejects malformed or oversized sprite URLs', () => {
    for (const url of [
      'panel:w=10,h=10',
      'sprite:kind=blob,w=10,h=10',
      'sprite:kind=disc,w=10',
      'sprite:kind=disc,w=0,h=10',
      'sprite:kind=disc,w=99999,h=10',
      'sprite:kind=disc,w=10,h=10,sigma=abc',
      'sprite:kind=disc,w=10,h=10,c=red',
      'sprite:kind=piece,w=10,h=10,shape=star',
    ]) {
      expect(parseSpriteUrl(url), url).toBeNull();
    }
  });

  it('runs without Buffer or zlib (Hermes / browser)', () => {
    const sources = ['fx-sprites.ts', 'fx-sprite-shapes.ts', 'png-encode.ts'].map((file) =>
      fs.readFileSync(path.resolve(here, '../src/editor/presets', file), 'utf8')
    );

    for (const source of sources) {
      expect(source).not.toMatch(/\bBuffer\.|new Buffer|from ['"](node:)?zlib['"]|from ['"]node:|require\(/);
    }

    const saved = globalThis.Buffer;
    let png: Uint8Array = new Uint8Array(0);

    try {
      // @ts-expect-error -- simulate a runtime without Node's Buffer
      delete globalThis.Buffer;
      png = spritePng(SPECS.band);
    } finally {
      globalThis.Buffer = saved;
    }

    expect(sha(png)).toBe(SHA256.band);
  });
});
