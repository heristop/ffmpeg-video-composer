import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { asFilter, blurGate, blurHead, blurPad, blurTail, planBlur } from '@/editor/presets/motion-blur';

const W = 200;
const H = 8;
const span = { first: 3, last: 7 };

// Each output frame's middle row (gray), sharp everywhere but over `span`.
function rows(shutter: number, base = 'color=black:s=200x8:r=10:d=1,format=yuv444p'): Uint8Array[] {
  const clock = { fps: 10, samples: 4, shutter };
  const head = blurHead(span, clock).join(',');
  const tail = blurTail(clock).join(',');
  const graph =
    `${base},split=2[a][b];color=white:s=20x8:r=10:d=1,format=yuv444p,split=2[la][lb];` +
    `[a][la]overlay=x='160*t':y=0:eof_action=pass:format=yuv444[sharp];[b]${head}[bs];[lb]${head}[ls];` +
    `[bs][ls]overlay=x='160*t':y=0:format=yuv444,${tail}[blur];` +
    `[sharp][blur]overlay=0:0:eof_action=pass:format=yuv444,format=gray[out]`;
  const out = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-filter_complex', graph, '-map', '[out]', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { maxBuffer: 1 << 24 }
  );

  return Array.from({ length: out.length / (W * H) }, (_, f) => out.subarray(f * W * H + 4 * W, f * W * H + 5 * W));
}

const lit = (row: Uint8Array) => {
  const xs = [...row.keys()].filter((x) => row[x] > 8);

  return [xs[0], xs.at(-1)];
};

describe('blurHead / blurTail', () => {
  it('cuts the span on half-frame edges, repeats each frame, and retimes onto the shutter clock', () => {
    const clock = { fps: 30, samples: 8, shutter: 180 };

    expect(blurHead({ first: 14, last: 31 }, clock)).toEqual([
      'trim=start=0.45:end=1.05',
      'fps=240:round=down',
      'settb=1/86400',
      "setpts='STARTPTS+(floor(N/8)+mod(N,8)*0.0625)/30/TB'",
    ]);
    expect(blurTail(clock)).toEqual(['tmix=frames=8', "setpts='STARTPTS+floor(N/8)/30/TB'", 'fps=30']);
  });

  it('keeps setpts as a values.expr filter so the section speed never replaces it', () => {
    expect(asFilter("setpts='STARTPTS+floor(N/8)/30/TB'")).toEqual({
      type: 'setpts',
      values: { expr: "'STARTPTS+floor(N/8)/30/TB'" },
    });
    expect(asFilter('tmix=frames=8')).toEqual({ type: 'tmix', value: 'frames=8' });
  });
});

describe('motion blur through real ffmpeg', () => {
  it('smears a 360° shutter over the whole frame interval, and only over the span', () => {
    const frames = rows(360);

    expect(frames).toHaveLength(10);
    expect(lit(frames[2])).toEqual([32, 51]);
    expect(lit(frames[5])).toEqual([80, 111]);
    expect([frames[5][81], frames[5][85], frames[5][89], frames[5][95]]).toEqual([64, 128, 191, 255]);
    expect(lit(frames[8])).toEqual([128, 147]);
  });

  it('smears a 180° shutter over half of it', () => {
    expect(lit(rows(180)[5])).toEqual([80, 105]);
  });

  it('keeps a background that changes every frame sharp (no ghosting)', () => {
    const changing = 'color=black:s=200x8:r=10:d=1,format=yuv444p,geq=lum=16+10*N:cb=128:cr=128';
    const frames = rows(360, changing);
    const far = frames.map((row) => row[190]);

    // Each frame shows its own base frame: a strictly increasing step, never an average of two.
    for (let f = 1; f < far.length; f++) expect(far[f] - far[f - 1], `frame ${f}`).toBeGreaterThanOrEqual(10);
  });
});

describe('planBlur', () => {
  const blur = { shutter: 180, samples: 8 };

  it('warns and draws sharp without tmix', () => {
    const warnings: string[] = [];
    const plan = planBlur([{ first: 14, last: 31 }], blur, 30, { has: () => false, warn: (m) => warnings.push(m) });

    expect(plan).toBeNull();
    expect(warnings[0]).toMatch(/^\[motion_blur_unavailable\]/);
  });

  it('lowers the samples within the budget and says so', () => {
    const warnings: string[] = [];
    const plan = planBlur([{ first: 0, last: 399 }], { shutter: 180, samples: 16 }, 30, {
      has: () => true,
      warn: (m) => warnings.push(m),
    });

    expect(plan?.shutter).toEqual({ fps: 30, samples: 3, shutter: 180 });
    expect(warnings[0]).toMatch(/^\[motion_blur_capped\] 16 samples/);
  });

  it('plans nothing for an element that never moves', () => {
    expect(planBlur([], blur, 30, { has: () => true, warn: () => undefined })).toBeNull();
  });
});

describe('guards on numbers written into filter text', () => {
  const clock = { fps: 30, samples: 8, shutter: 180 };
  const env = { has: () => true, warn: () => undefined };

  it('rejects a non-finite or non-positive fps', () => {
    expect(() => blurHead(span, { ...clock, fps: Number.NaN })).toThrow(/not a number/);
    expect(() => blurTail({ ...clock, fps: '30; movie=x' as unknown as number })).toThrow(/not a number/);
    expect(() => blurHead(span, { ...clock, fps: 0 })).toThrow(/fps/);
    expect(() => blurTail({ ...clock, fps: -30 })).toThrow(/fps/);
  });

  it('rejects samples that are not integers in 2..16', () => {
    for (const samples of [1, 17, 2.5, Number.POSITIVE_INFINITY, '8,x' as unknown as number]) {
      expect(() => blurHead(span, { ...clock, samples }), String(samples)).toThrow();
      expect(() => blurTail({ ...clock, samples }), String(samples)).toThrow();
    }
  });

  it('rejects a shutter that is not an integer in 1..360', () => {
    for (const shutter of [0, -10, 361, 90.5, Number.NaN, 'x' as unknown as number]) {
      expect(() => blurHead(span, { ...clock, shutter }), String(shutter)).toThrow();
    }
  });

  it('rejects span frame indices that are not integers and clamps a negative start to frame 0', () => {
    expect(() => blurHead({ first: 1.5, last: 4 }, clock)).toThrow(/span/);
    expect(() => blurHead({ first: 1, last: Number.NaN }, clock)).toThrow(/not a number/);
    expect(() => blurHead({ first: 1, last: 0 }, clock)).toThrow(/span/);
    expect(blurHead({ first: -5, last: 3 }, clock)[0]).toBe('trim=start=0:end=0.116667');
  });

  it('plans or drops a span keyed far past the end instead of throwing', () => {
    const blur = { shutter: 180, samples: 8 };

    expect(() => planBlur([{ first: 5, last: 3e9 }], blur, 30, env)).not.toThrow();
    expect(planBlur([{ first: 3e9, last: 4e9 }], blur, 30, env)?.spans ?? []).toSatisfy((spans: { last: number }[]) =>
      spans.every((s) => s.last <= 10_000_000)
    );
    expect(planBlur([{ first: -9, last: -3 }], blur, 30, env)).toBeNull();
  });

  it('guards planBlur input before any filter is planned', () => {
    expect(() => planBlur([{ first: 0, last: 3 }], { shutter: 500, samples: 8 }, 30, env)).toThrow();
    expect(() => planBlur([{ first: 0, last: 3 }], { shutter: 180, samples: 99 }, 30, env)).toThrow();
    expect(() => planBlur([{ first: 0, last: 3 }], { shutter: 180, samples: 8 }, Number.NaN, env)).toThrow();
    expect(() => planBlur([{ first: -2, last: 3 }], { shutter: 180, samples: 8 }, 30, env)).not.toThrow();
  });

  it('pads the frames before a late span and gates the overlay to its edges', () => {
    const clock = { fps: 30, samples: 8, shutter: 180 };

    expect(blurPad({ first: 540, last: 570 }, clock)).toEqual(['trim=end=17.983333', 'setpts=PTS-STARTPTS']);
    expect(blurGate({ first: 540, last: 570 }, clock)).toBe("enable='between(t,17.983333,19.016667)'");
    expect(blurPad({ first: 0, last: 30 }, clock)).toEqual([]);
    expect(blurGate({ first: 0, last: 30 }, clock)).toBe("enable='between(t,0,1.016667)'");
  });

  it('refuses an unsafe span or clock in the pad and the gate', () => {
    expect(() => blurPad({ first: 1, last: Number.NaN }, { fps: 30, samples: 8, shutter: 180 })).toThrow();
    expect(() => blurGate({ first: 1, last: 5 }, { fps: 30, samples: 8, shutter: '1;x' as never })).toThrow();
  });

  // concat times the frames after a pad from the pad's mean frame spacing, which needs two frames: a one-frame
  // pad would start the blurred frames a frame early. A span on frame 1 runs unpadded (gated) instead.
  it('emits no pad for a span starting on frame 0 or 1, and pads from frame 2', () => {
    const clock = { fps: 30, samples: 8, shutter: 180 };

    expect(blurPad({ first: 0, last: 9 }, clock)).toEqual([]);
    expect(blurPad({ first: 1, last: 9 }, clock)).toEqual([]);
    expect(blurPad({ first: 2, last: 9 }, clock)).toEqual(['trim=end=0.05', 'setpts=PTS-STARTPTS']);
  });
});
