import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { blendOver } from '@/editor/presets/layer-blend';
import type { BlendMode } from '@/schemas/layer-composite.schemas';

// One frame of `layer` (16×16 at 8,8) blended over a 64×32 yuv420p `base`, read back as RGB.
function render(base: string, layer: string, mode: BlendMode): (x: number, y: number) => number[] {
  const chains = blendOver({ base: 'base', leg: 'leg', overlay: '8:8:eof_action=pass', mode, prefix: 'p', out: 'out' });
  const graph =
    `color=c=${base}:s=64x32:r=10:d=0.2,format=yuv420p[base];` +
    `color=c=${layer}:s=16x16:r=10:d=0.2,format=rgba[leg];${chains.join(';')}`;
  const out = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-filter_complex',
    graph,
    '-map',
    '[out]',
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);

  return (x, y) => [...out.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3)];
}

function near(actual: number[], expected: number[]): void {
  for (const [i, value] of actual.entries()) {
    expect(Math.abs(value - expected[i]), `${actual.join(',')} vs ${expected.join(',')}`).toBeLessThanOrEqual(3);
  }
}

describe('blendOver chains', () => {
  it('is a plain overlay for normal', () => {
    expect(blendOver({ base: 'b', leg: 'l', overlay: '10:20', mode: 'normal', prefix: 'p', out: 'o' })).toEqual([
      '[b][l]overlay=10:20[o]',
    ]);
  });

  it('blends in gbrap over a transparent copy of the frame, then lays the result back by its alpha', () => {
    expect(blendOver({ base: 'b', leg: 'l', overlay: '10:20', mode: 'multiply', prefix: 'p', out: 'o' })).toEqual([
      '[b]split=3[pb0][pb1][pb2]',
      '[pb1]format=gbrap,colorchannelmixer=rr=0:gg=0:bb=0:aa=0[pcv]',
      '[pcv][l]overlay=10:20:format=gbrp[ply]',
      '[pb2]format=gbrap[pba]',
      '[ply][pba]blend=c0_mode=multiply:c1_mode=multiply:c2_mode=multiply:c3_mode=normal:c3_opacity=1[pmx]',
      '[pb0][pmx]overlay=0:0:format=auto[o]',
    ]);
  });
});

describe('blendOver guards (templates that skipped validation)', () => {
  const ok = { base: 'b', leg: 'l', overlay: '10:20', mode: 'multiply' as BlendMode, prefix: 'p', out: 'o' };

  it('refuses a pad label that would splice filtergraph text', () => {
    for (const key of ['base', 'leg', 'prefix', 'out'] as const) {
      expect(() => blendOver({ ...ok, [key]: 'x];[y' })).toThrow(/Unsafe pad label/);
    }
  });

  it('refuses an overlay position that would chain another filter', () => {
    expect(() => blendOver({ ...ok, overlay: '10:20,movie=/etc/passwd' })).toThrow(/Unsafe overlay/);
    expect(() => blendOver({ ...ok, overlay: '10:20:enable=1,hflip' })).toThrow(/Unsafe overlay/);
    expect(() => blendOver({ ...ok, overlay: '10' })).toThrow(/Unsafe overlay/);
  });

  it('accepts the option forms MapManager emits', () => {
    for (const overlay of [
      '10:20:eof_action=pass',
      "0:0:eof_action=repeat:enable='between(t,1.5,4)'",
      "(W-w)/2:H-h:eof_action=pass:enable='gte(t,2)'",
      "x='W/2+sin(t*2)*10':y='H/2':eof_action=pass:enable='between(t,0,-1e-7)'",
    ]) {
      expect(blendOver({ ...ok, overlay }).join(';')).toContain(`overlay=${overlay}:format=gbrp`);
    }
  });

  it('refuses anything else among the options', () => {
    for (const overlay of [
      "10:20:enable='1);evil'",
      "10:20:enable='between(t,1,2)',hflip",
      "10:20:enable='between(t,1,2);x'",
      "10:20:enable='between(t,[a],2)'",
      '10:20:eof_action=pass,hflip',
      '10:20:eof_action=pass;[x]',
      "x='1':y='2];[x'",
      "x='1':y='2':eof_action=pass,hflip",
      "x='1':y='2'junk,hflip",
      "x='1':y='2'hflip",
      "x='a b':y='2'",
      "x='a\"b':y='2'",
      "x='$a':y='2'",
      "x='a=b':y='2'",
    ]) {
      expect(() => blendOver({ ...ok, overlay }), overlay).toThrow(/Unsafe overlay/);
    }
  });

  it('refuses an unknown blend mode', () => {
    expect(() => blendOver({ ...ok, mode: 'constructor' as BlendMode })).toThrow(/Unknown blend mode/);
  });
});

describe('blend modes through real ffmpeg', () => {
  it('computes each mode in RGB over the picture', () => {
    const cases: Array<[BlendMode, number]> = [
      ['multiply', 48],
      ['screen', 208],
      ['add', 255],
      ['darken', 64],
      ['lighten', 192],
      ['difference', 128],
    ];

    for (const [mode, inside] of cases) {
      const px = render('0x404040', '0xC0C0C0', mode);
      near(px(16, 16), [inside, inside, inside]);
      near(px(50, 16), [64, 64, 64]);
    }
  });

  it('multiplies colours channel by channel (red over green is black, not a grey mix)', () => {
    near(render('0x00FF00', '0xFF0000', 'multiply')(16, 16), [0, 0, 0]);
  });

  it('means design-tool overlay: the picture beneath decides', () => {
    near(render('0x404040', '0xC0C0C0', 'overlay')(16, 16), [96, 96, 96]);
    near(render('0xC0C0C0', '0x808080', 'overlay')(16, 16), [192, 192, 192]);
  });

  it('leaves the picture untouched where the layer is transparent', () => {
    near(render('0x404040', '0xC0C0C0@0', 'multiply')(16, 16), [64, 64, 64]);
  });

  it('weights a half-transparent layer by its alpha, with its own colour (no dark fringe)', () => {
    near(render('0x404040', '0xC0C0C0@0.5', 'multiply')(16, 16), [56, 56, 56]);
  });
});
