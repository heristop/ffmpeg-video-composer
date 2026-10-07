import { describe, expect, it } from 'vitest';
import {
  footageLength,
  footagePlan,
  hasFootageEdits,
  presetRampKeys,
  rampLength,
  rampPieces,
  rampTimeOf,
  sourceAt,
} from '@/core/footage/plan';
import { SPEED_RAMP_PRESETS, SPEED_RAMP_PRESET_TABLE } from '@/core/footage/presets';
import {
  atempoChain,
  audioParts,
  footageAudioChain,
  footageVideoFilters,
  rampExpr,
} from '@/editor/utils/footage-lowering';
import { blurFillGraph, coverCrop, reframeFilters, resolveFit } from '@/editor/utils/reframe';
import { knownDuration, sectionStarts } from '@/core/timing/timeline';
import { resolveTimeRefs } from '@/core/timing/resolve';
import { motionCatalog } from '@/core/motion/catalog';

const FORMAT = { sampleRate: 44100, channelLayout: 'stereo' };

describe('footage plan', () => {
  it('detects edits', () => {
    expect(hasFootageEdits(undefined)).toBe(false);
    expect(hasFootageEdits({ duration: 3 })).toBe(false);
    expect(hasFootageEdits({ freeze: [] })).toBe(false);
    expect(hasFootageEdits({ clip: {} })).toBe(true);
    expect(hasFootageEdits({ speedRamp: 'hero' })).toBe(true);
  });

  it('trims the source range and clamps the out-point to the clip', () => {
    expect(footagePlan({ clip: { from: 1, to: 3.5 } }, 5, 30)).toMatchObject({
      from: 1,
      to: 3.5,
      span: 2.5,
      length: 2.5,
    });
    expect(footagePlan({ clip: { from: 1, to: 9 } }, 5, 30)).toMatchObject({ to: 5, span: 4, length: 4 });
    // Unprobed source with no out-point: the length is unknown before rendering.
    expect(footagePlan({ clip: { from: 1 } }, undefined, 30)?.length).toBeUndefined();
  });

  it('integrates a ramp: constant pieces whose source spans add up', () => {
    const pieces = rampPieces([
      { at: 0, speed: 1 },
      { at: 2, speed: 3 },
    ]);

    expect(pieces).toHaveLength(9);
    expect(pieces[0]).toEqual({ o0: 0, s0: 0, speed: 1.125 });
    // A linear ramp 1 → 3 over 2 s consumes the mean speed (2) × 2 s = 4 s of source.
    expect(sourceAt(pieces, 2)).toBeCloseTo(4, 5);
    expect(rampLength(pieces, 4)).toBeCloseTo(2, 5);
    // After the last key the last speed holds: 3 more seconds of source take 1 s.
    expect(rampLength(pieces, 7)).toBeCloseTo(3, 5);
  });

  it('places preset keys so each one is reached at its fraction of the source', () => {
    for (const preset of SPEED_RAMP_PRESETS) {
      const keys = presetRampKeys(preset, 10);
      const pieces = rampPieces(keys);

      for (const [index, key] of SPEED_RAMP_PRESET_TABLE[preset].keys.entries()) {
        expect(sourceAt(pieces, keys[index].at), `${preset} key ${index}`).toBeCloseTo(key.p * 10, 4);
      }
    }
  });

  it('adds freeze holds on the frame grid and maps section time back to ramp time', () => {
    const plan = footagePlan(
      {
        freeze: [
          { at: 1, hold: 0.5 },
          { at: 3, hold: 0.25 },
        ],
      },
      4,
      30
    );

    expect(plan?.freezes.map((f) => [f.frame, f.frames])).toEqual([
      [30, 15],
      [90, 8],
    ]);
    expect(plan?.length).toBe(Number(((120 + 23) / 30).toFixed(6)));
    expect(rampTimeOf(1.2, plan?.freezes ?? [], 30)).toBe(1);
    expect(rampTimeOf(2, plan?.freezes ?? [], 30)).toBe(1.5);
  });

  it('waits for time references and tolerates a malformed ramp', () => {
    expect(footagePlan({ freeze: [{ at: 'beat:2', hold: 1 }] }, 5, 30)).toBeNull();
    expect(footagePlan({ speedRamp: [{ at: '50%', speed: 2 }] }, 5, 30)).toBeNull();
    expect(footageLength({ speedRamp: 'nope' as never }, 5, 30)).toBeUndefined();
    expect(footageLength({}, 5, 30)).toBe(5);
  });
});

describe('footage lowering', () => {
  it('lowers a ramp to a nested setpts expression in source time', () => {
    expect(
      rampExpr([
        { o0: 0, s0: 0, speed: 1 },
        { o0: 1, s0: 1, speed: 0.5 },
      ])
    ).toBe('if(lt(T,1),T,1+(T-1)/0.5)');
  });

  it('keeps every atempo inside 0.5..2', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(0.2)).toEqual(['atempo=0.5', 'atempo=0.5', 'atempo=0.8']);
    expect(atempoChain(5)).toEqual(['atempo=2', 'atempo=2', 'atempo=1.25']);
  });

  it('builds the video head in order: trim, restart, ramp, conform, loop, restamp', () => {
    const plan = footagePlan(
      { clip: { from: 1, to: 3 }, speedRamp: 'flash-in', freeze: [{ at: 0.5, hold: 0.2 }] },
      6,
      25
    );
    const types = footageVideoFilters(plan as NonNullable<typeof plan>, 25).map((filter) => filter.type);

    expect(types).toEqual(['trim', 'setpts', 'setpts', 'fps', 'loop', 'setpts']);
  });

  it('splits the sound at a silent freeze and appends a continuing one', () => {
    const silent = footagePlan({ clip: { to: 4 }, freeze: [{ at: 1, hold: 0.5 }] }, 6, 30);
    const kept = footagePlan({ clip: { to: 4 }, freeze: [{ at: 1, hold: 0.5, audio: 'continue' }] }, 6, 30);

    expect(audioParts(silent as NonNullable<typeof silent>, 30)).toEqual([
      { kind: 'source', s0: 0, s1: 1, speed: 1 },
      { kind: 'silence', seconds: 0.5 },
      { kind: 'source', s0: 1, s1: 4, speed: 1 },
    ]);
    expect(audioParts(kept as NonNullable<typeof kept>, 30)).toEqual([
      { kind: 'source', s0: 0, s1: 4, speed: 1 },
      { kind: 'silence', seconds: 0.5 },
    ]);
    expect(footageAudioChain(silent as NonNullable<typeof silent>, 30, FORMAT, {})).toEqual([
      'asplit=2[fa0][fa1];[fa0]atrim=start=0:end=1,asetpts=PTS-STARTPTS[fp0];aevalsrc=0:d=0.5:s=44100:c=stereo[fp1];' +
        '[fa1]atrim=start=1:end=4,asetpts=PTS-STARTPTS[fp2];[fp0][fp1][fp2]concat=n=3:v=0:a=1',
    ]);
  });

  it('mutes ramped pieces with rampAudio mute', () => {
    const plan = footagePlan({ speedRamp: [{ at: 0, speed: 2 }] }, 4, 30);
    const [chain] = footageAudioChain(plan as NonNullable<typeof plan>, 30, FORMAT, { rampAudio: 'mute' });

    expect(chain).toBe('atrim=start=0:end=4,asetpts=PTS-STARTPTS,atempo=2,volume=0');
  });
});

describe('reframe', () => {
  it('resolves fit from the option, else the legacy flags', () => {
    expect(resolveFit(undefined)).toBe('cover');
    expect(resolveFit({ forceOriginalAspectRatio: true })).toBe('letterbox');
    expect(resolveFit({ forceAspectRatio: false })).toBe('off');
    expect(resolveFit({ fit: 'blur', forceOriginalAspectRatio: true })).toBe('blur');
  });

  it('anchors cover crops', () => {
    expect(coverCrop('1280:720', undefined)).toBe('1280:720');
    expect(coverCrop('1280:720', 'right')).toBe('1280:720:(iw-ow)*1:(ih-oh)*0.5');
    expect(coverCrop('1280:720', 'top')).toBe('1280:720:(iw-ow)*0.5:0');
    expect(coverCrop('1280:720', [{ t: 0, x: 0, y: 1 }])).toBe("1280:720:x='(iw-ow)*(0)':y='(ih-oh)*(1)'");
  });

  it('builds the blur fill subgraph from allowlisted filters', () => {
    const graph = blurFillGraph('1280:720', { dim: 0 }, 30);

    expect(graph).not.toContain('lutyuv');
    // Filter names: each `,`/`;`-separated node, labels stripped, up to its `=`.
    const names = graph
      .split(/[;,]/)
      .map((node) => node.replace(/^(\[[a-z_]+\])+/, '').split('=')[0])
      .filter((name) => /^[a-z]+$/.test(name));

    expect(names).toEqual(['scale', 'crop', 'gblur', 'scale', 'overlay', 'setpts']);
    expect(reframeFilters({ fit: 'blur' }, { scale: '1280:720', setsar: '1/1', fps: 30 }).map((f) => f.type)).toEqual([
      'setsar',
      'fps',
      'split',
    ]);
    expect(reframeFilters({ fit: 'off' }, { scale: '1280:720', setsar: '1/1', fps: 30 })).toEqual([]);
  });
});

describe('footage timing', () => {
  it('caps a video section at its edited length before any probe', () => {
    expect(knownDuration({ type: 'video', options: { duration: 5, clip: { from: 2, to: 4 } } })).toBe(2);
    expect(knownDuration({ type: 'video', options: { duration: 5, clip: { from: 2 } } })).toBe(5);
    expect(knownDuration({ type: 'project_video', options: { duration: 5, clip: { to: 1 } } })).toBeUndefined();
    expect(
      sectionStarts([
        { type: 'video', options: { duration: 5, clip: { to: 2 } } },
        { type: 'color_background', options: { duration: 2 } },
      ])
    ).toEqual([0, 2]);
  });

  it('resolves footage time references in section time', () => {
    const { descriptor, issues } = resolveTimeRefs({
      global: { beats: { bpm: 120 } },
      sections: [
        {
          name: 'clip',
          type: 'video',
          options: {
            duration: 4,
            speedRamp: [
              { at: 'beat:2', speed: 1 },
              { at: '75%', speed: 0.5 },
            ],
            freeze: [{ at: 'cue:hit', hold: 0.5 }],
            focus: [{ t: 'end - 1', x: 0, y: 0 }],
          },
          cues: { hit: 1.2 },
        },
      ],
    });
    const options = (
      descriptor.sections as unknown as Array<{ options: Record<string, Array<Record<string, number>>> }>
    )[0].options;

    expect(issues).toEqual([]);
    expect(options.speedRamp.map((key) => key.at)).toEqual([0.5, 3]);
    expect(options.freeze[0].at).toBe(1.2);
    expect(options.focus[0].t).toBe(3);
  });

  it('exposes the presets and fields in the motion catalog', () => {
    const catalog = motionCatalog();

    expect(catalog.footage.speedRamps.map((entry) => entry.preset)).toEqual([...SPEED_RAMP_PRESETS]);
    expect(Object.keys(catalog.footage.fits)).toEqual(['cover', 'letterbox', 'blur', 'off']);
    expect(catalog.timing.fields).toContain('options.freeze[].at');
  });
});
