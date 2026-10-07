import { describe, expect, it } from 'vitest';
import type { ProjectBuildInfos, Section, TemplateDescriptorGlobal } from '@/core/types';
import { MAX_SFX, planSfx, videoTimeline } from '@/editor/utils/sfx-plan';
import { sfxFiles, sfxGraph } from '@/editor/utils/sfx-mix';
import { musicMixGraph, sfxOnlyGraph } from '@/editor/utils/music-mix';

const CHANNEL = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

type Timing = Pick<ProjectBuildInfos, 'durations' | 'transitions'>;

function section(name: string, duration: number, extra: Partial<Section> = {}): Section {
  return { name, type: 'color_background', options: { duration }, ...extra } as Section;
}

const cuts: Timing = { durations: { a: 4, b: 3, c: 5 }, transitions: [{ type: 'cut', duration: 0 }] };

describe('sound-effect timeline', () => {
  it('starts each section after the earlier ones, minus each xfade overlap', () => {
    const segments = [section('a', 4), section('b', 3), section('c', 5)];
    const fades: Timing = {
      durations: { a: 4, b: 3, c: 5 },
      transitions: [
        { type: 'fade', duration: 0.5 },
        { type: 'cut', duration: 0 },
      ],
    };

    // A cut inside an xfade assembly is a concat: no overlap.
    expect(videoTimeline(segments, fades)).toEqual({ starts: [0, 3.5, 6.5], total: 11.5 });
    expect(videoTimeline(segments, { ...cuts, transitions: [] })).toEqual({ starts: [0, 4, 7], total: 12 });
  });

  it('shifts section sounds by the section start, anchors a riser by its end and keeps global sounds as is', () => {
    const segments = [
      section('a', 4, { sfx: [{ id: 'hit', at: 1 }] }),
      section('b', 3, { sfx: [{ id: 'riser', at: 0.5, volume: 0.8 }] }),
    ];
    const global: TemplateDescriptorGlobal = { sfx: [{ id: 'ding', at: 6.5 }] };

    expect(planSfx(segments, cuts, global)).toEqual([
      { id: 'hit', file: 'hit.m4a', start: 1, trim: 0, volume: 0.7 },
      // Ends at 4 + 0.5 = 4.5, so it starts 2 s earlier.
      { id: 'riser', file: 'riser.m4a', start: 2.5, trim: 0, volume: 0.8 },
      { id: 'ding', file: 'ding.m4a', start: 6.5, trim: 0, volume: 0.45 },
    ]);
  });

  it('trims the head of a riser that would start before the video, and drops sounds past the end', () => {
    const segments = [section('a', 4, { sfx: [{ id: 'riser', at: 0.5 }] })];
    const global: TemplateDescriptorGlobal = { sfx: [{ id: 'pop', at: 9 }] };

    expect(planSfx(segments, { durations: { a: 4 }, transitions: [] }, global)).toEqual([
      { id: 'riser', file: 'riser.m4a', start: 0, trim: 1.5, volume: 0.5 },
    ]);
  });

  it('orders by start then id and caps the total', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: 'tick' as const, at: (30 - i) * 0.1 }));
    const segments = [section('a', 4, { sfx: many }), section('b', 3, { sfx: many })];
    const plan = planSfx(segments, cuts, undefined);

    expect(plan).toHaveLength(MAX_SFX);
    const starts = plan.map((sound) => sound.start);

    expect(starts).toEqual(starts.toSorted((x, y) => x - y));
  });
});

describe('sound-effect mix graph', () => {
  const placements = [
    { id: 'hit' as const, file: 'hit.m4a', start: 1.25, trim: 0, volume: 0.7 },
    { id: 'whoosh' as const, file: 'whoosh.m4a', start: 0, trim: 0, volume: 0.5 },
    { id: 'hit' as const, file: 'hit.m4a', start: 3, trim: 0, volume: 0.35 },
    { id: 'riser' as const, file: 'riser.m4a', start: 0, trim: 0.4, volume: 0.5 },
  ];

  it('takes one input per file and splits a file that plays twice', () => {
    expect(sfxFiles(placements)).toEqual(['hit.m4a', 'whoosh.m4a', 'riser.m4a']);

    const { graph, labels } = sfxGraph({
      placements,
      firstInput: 2,
      channelConfig: CHANNEL,
      sampleRate: 48000,
      deviceFilters: null,
    });

    expect(labels).toEqual(['sfx0', 'sfx1', 'sfx2', 'sfx3']);
    expect(graph).toBe(
      '[2:a]asplit=2[sfxin0_0][sfxin0_1]; ' +
        `[sfxin0_0]${CHANNEL},volume=0.7,adelay=1250|1250[sfx0]; ` +
        `[3:a]${CHANNEL},volume=0.5[sfx1]; ` +
        `[sfxin0_1]${CHANNEL},volume=0.35,adelay=3000|3000[sfx2]; ` +
        `[4:a]atrim=start=0.4,asetpts=PTS-STARTPTS,${CHANNEL},volume=0.5[sfx3]; `
    );
  });

  it('builds the offset from a silent lead when the engine lacks adelay', () => {
    const { graph } = sfxGraph({
      placements: [placements[0]],
      firstInput: 1,
      channelConfig: CHANNEL,
      sampleRate: 48000,
      deviceFilters: new Set(['anullsrc', 'atrim', 'concat', 'aformat', 'volume']),
    });

    expect(graph).toBe(
      `anullsrc=r=48000:cl=stereo,atrim=duration=1.25,${CHANNEL}[sfxlead0]; ` +
        `[1:a]${CHANNEL},volume=0.7[sfxbody0]; [sfxlead0][sfxbody0]concat=n=2:v=0:a=1[sfx0]; `
    );
  });

  it('lays the sounds over the music/voice bed before loudnorm', () => {
    const sfx = sfxGraph({ placements, firstInput: 2, channelConfig: CHANNEL, sampleRate: 48000, deviceFilters: null });
    const graph = musicMixGraph({
      global: { audio: { normalize: 'loudnorm', ducking: true } },
      musicFilters: [],
      multipleSegments: false,
      audioVolumeLevel: 1,
      reduceNoiseConfig: 'afftdn=nr=20:nf=-20',
      channelConfig: CHANNEL,
      hasSegmentAudio: true,
      sfx,
    });

    expect(graph).toContain('[vout][ducked]amix=inputs=2:duration=first:normalize=0[bed]; ');
    expect(
      graph.endsWith(
        '[bed][sfx0][sfx1][sfx2][sfx3]amix=inputs=5:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[final]'
      )
    ).toBe(true);
    expect(graph.match(/loudnorm/g)).toHaveLength(1);
  });

  it('mixes over the clip sound alone, or over silence as long as the video', () => {
    const sfx = sfxGraph({
      placements: [placements[1]],
      firstInput: 1,
      channelConfig: CHANNEL,
      sampleRate: 48000,
      deviceFilters: null,
    });
    const bed = { channelConfig: CHANNEL, total: 6.5, sampleRate: 48000 };

    expect(sfxOnlyGraph(undefined, sfx, { ...bed, hasSegmentAudio: true })).toBe(
      `[0:a]${CHANNEL}[bed]; [1:a]${CHANNEL},volume=0.5[sfx0]; [bed][sfx0]amix=inputs=2:duration=first:normalize=0[final]`
    );
    expect(sfxOnlyGraph({ audio: { normalize: 'dynaudnorm' } }, sfx, { ...bed, hasSegmentAudio: false })).toBe(
      `anullsrc=r=48000:cl=stereo,atrim=duration=6.5,${CHANNEL}[bed]; [1:a]${CHANNEL},volume=0.5[sfx0]; ` +
        '[bed][sfx0]amix=inputs=2:duration=first:normalize=0,dynaudnorm=f=150:g=15[final]'
    );
  });
});
