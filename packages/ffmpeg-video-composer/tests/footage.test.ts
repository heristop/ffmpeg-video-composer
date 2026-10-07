import { describe, expect, it } from 'vitest';
import {
  blendTowardIdentity,
  CubeParseError,
  identityAt,
  parseCube,
  quantizeStrength,
  serializeCube,
} from '@/core/footage/lut-cube';
import { cubeFor } from '@/editor/presets/lut-library';
import { lutFileStem, parseLutValue, presetLutValue, urlLutValue } from '@/editor/presets/lut-spec';
import { gradeToFilters, lookToFilters } from '@/editor/presets/looks';
import { displayRotation, frameRate, mediaTraits, reportedTraits } from '@/core/footage/media-traits';
import {
  clipKeepRanges,
  computeKeepRanges,
  keptDuration,
  parseSilencedetect,
  resolveTrimSilence,
  silencedetectFilter,
} from '@/core/footage/keep-ranges';
import { footageFilterArgs, hasFootageGraph, type FootageGraphInput } from '@/editor/footage/footage-graph';
import { parseFilterList } from '@/services/footage-analysis-node';
import { knownDuration } from '@/core/timing/timeline';
import { TemplateValidator } from '@/services/TemplateValidator';

function rows(cube: string): string[] {
  return cube
    .trimEnd()
    .split('\n')
    .filter((line) => /^[0-9-]/.test(line));
}

describe('LUT strength', () => {
  it('keeps the full-strength cube byte-identical and the bare preset name', () => {
    expect(cubeFor('teal-orange', 5, 1)).toBe(cubeFor('teal-orange', 5));
    expect(presetLutValue('teal-orange')).toBe('teal-orange');
    expect(presetLutValue('teal-orange', 1)).toBe('teal-orange');
    expect(lutFileStem('teal-orange')).toBe('teal-orange');
  });

  it('is the identity grid at strength 0', () => {
    const identity = rows(cubeFor('noir', 3, 0)!);

    expect(identity.slice(0, 4)).toEqual([
      '0.000000 0.000000 0.000000',
      '0.500000 0.000000 0.000000',
      '1.000000 0.000000 0.000000',
      '0.000000 0.500000 0.000000',
    ]);
    expect(identity.at(-1)).toBe('1.000000 1.000000 1.000000');
  });

  it('blends linearly between identity and the preset', () => {
    const full = rows(cubeFor('noir', 3)!).map((row) => row.split(' ').map(Number));
    const half = rows(cubeFor('noir', 3, 0.5)!).map((row) => row.split(' ').map(Number));
    for (const [index, row] of half.entries()) {
      const identity = identityAt({ size: 3, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }, index);

      for (const [channel, value] of row.entries()) {
        expect(value).toBeCloseTo((identity[channel] + full[index][channel]) / 2, 5);
      }
    }
  });

  it('quantizes strength and names the staged file after it', () => {
    expect(quantizeStrength(0.12345)).toBe(0.123);
    expect(quantizeStrength(undefined)).toBe(1);
    expect(quantizeStrength(4)).toBe(1);
    expect(lutFileStem(presetLutValue('teal-orange', 0.6))).toBe('teal-orange-s0600');
    expect(parseLutValue(urlLutValue('https://cdn.example/a@b/log.cube', 0.25))).toEqual({
      kind: 'url',
      url: 'https://cdn.example/a@b/log.cube',
      strength: 0.25,
    });
    expect(lutFileStem(urlLutValue('luts/log.cube'))).toMatch(/^user-[0-9a-f]{16}-s1000$/);
  });

  it('lowers the object look form; string form unchanged', () => {
    expect(lookToFilters('teal-orange')).toEqual([{ type: 'lut3d', value: 'teal-orange' }]);
    expect(lookToFilters({ preset: 'teal-orange' })).toEqual([{ type: 'lut3d', value: 'teal-orange' }]);
    expect(lookToFilters({ preset: 'mono-film', strength: 0.4 })).toEqual([{ type: 'lut3d', value: 'mono@0.4' }]);
    expect(lookToFilters({ preset: 'mono-film', strength: 0 })).toEqual([]);
    // Not LUT-backed: strength is a validation error and ignored by the lowering.
    expect(lookToFilters({ preset: 'warm', strength: 0.4 })).toEqual(lookToFilters('warm'));
  });

  it('applies a user LUT first in the grade', () => {
    const filters = gradeToFilters({ contrast: 1.1, lut: { url: 'luts/slog3.cube', strength: 0.8 } });

    expect(filters[0]).toEqual({ type: 'lut3d', value: 'url:luts/slog3.cube@0.8' });
    expect(filters[1].type).toBe('eq');
    expect(gradeToFilters({ contrast: 1.1 })).toEqual([{ type: 'eq', value: 'contrast=1.1' }]);
  });
});

describe('.cube parsing', () => {
  const unit = ['LUT_3D_SIZE 2', '0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1'];

  function code(text: string): string | undefined {
    try {
      parseCube(text);
    } catch (error) {
      expect(error).toBeInstanceOf(CubeParseError);

      return (error as CubeParseError).code;
    }

    return undefined;
  }

  it('parses titles, comments and domains, and round-trips', () => {
    const lut = parseCube(['TITLE "x"', '# comment', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1', ...unit, ''].join('\n'));

    expect(lut.size).toBe(2);
    expect(lut.rows[1]).toEqual([1, 0, 0]);
    expect(parseCube(serializeCube(lut, 't'))).toEqual(lut);
    expect(blendTowardIdentity(lut, 0.3).rows).toEqual(lut.rows);
  });

  it('names the problem of a malformed file', () => {
    expect(code(unit.slice(1).join('\n'))).toBe('cube_missing_size');
    expect(code(['LUT_3D_SIZE 1', '0 0 0'].join('\n'))).toBe('cube_bad_size');
    expect(code(['LUT_1D_SIZE 4', '0 0 0'].join('\n'))).toBe('cube_bad_size');
    expect(code(unit.slice(0, -1).join('\n'))).toBe('cube_row_count');
    expect(code([...unit.slice(0, -1), '1 x 1'].join('\n'))).toBe('cube_bad_row');
    expect(code(['DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 0 1', ...unit].join('\n'))).toBe('cube_domain');
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0')).toThrow(/line 2/);
  });

  it('blends a non-unit domain toward its own identity', () => {
    const log = parseCube(
      ['DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', 'LUT_3D_SIZE 2', ...unit.slice(1).map(() => '1 1 1')].join('\n')
    );

    expect(blendTowardIdentity(log, 0).rows.at(-1)).toEqual([2, 2, 2]);
    expect(blendTowardIdentity(log, 0.5).rows[0]).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('probe traits', () => {
  it('reads HDR transfer, Dolby Vision, bit depth, VFR and rotation', () => {
    expect(mediaTraits({ color_transfer: 'arib-std-b67', pix_fmt: 'yuv420p10le' })).toMatchObject({
      hdr: 'hlg',
      bitDepth: 10,
    });
    expect(mediaTraits({ codec_tag_string: 'dvh1', color_transfer: 'smpte2084' }).hdr).toBe('dolby-vision');
    expect(mediaTraits({ side_data_list: [{ side_data_type: 'DOVI configuration record' }] }).hdr).toBe('dolby-vision');
    expect(mediaTraits({ pix_fmt: 'p010le' }).bitDepth).toBe(10);
    expect(mediaTraits({ r_frame_rate: '30/1', avg_frame_rate: '19/1' }).vfr).toBe(true);
    expect(mediaTraits({ r_frame_rate: '30/1', avg_frame_rate: '30/1' }).vfr).toBe(false);
    expect(displayRotation({ side_data_list: [{ rotation: -90 }] })).toBe(270);
    expect(displayRotation({ tags: { rotate: '180' } })).toBe(180);
    expect(frameRate('0/0')).toBeNull();
    expect(mediaTraits(undefined)).toMatchObject({ hdr: null, vfr: false, rotation: 0 });
  });

  it('reports traits only when the probe printed trait fields', () => {
    expect(reportedTraits({ codec_type: 'video', duration: '2' })).toEqual({});
    expect(reportedTraits({ pix_fmt: 'yuv420p' }).traits?.bitDepth).toBe(8);
  });

  it('parses the ffmpeg -filters listing', () => {
    const list = parseFilterList(
      ' T.. = Timeline support\n ..C amix              N->A       Audio mixing.\n .SC zscale            V->V       Apply resizing\n'
    );

    expect([...list]).toEqual(['amix', 'zscale']);
  });
});

describe('silence keep ranges', () => {
  const params = resolveTrimSilence({ gaps: {} });

  it('resolves defaults and the silencedetect filter', () => {
    expect(params).toEqual({ edges: true, gaps: true, minSilence: 0.6, margin: 0.15, threshold: -35 });
    expect(resolveTrimSilence({}).gaps).toBe(false);
    expect(silencedetectFilter(params)).toBe('silencedetect=noise=-35dB:d=0.6');
  });

  it('parses silencedetect output, including a silence running to the end', () => {
    const log = [
      '[silencedetect @ 0x1] silence_start: -0.0001',
      '[silencedetect @ 0x1] silence_end: 0.8 | silence_duration: 0.8',
      '[silencedetect @ 0x1] silence_start: 1.8',
      '[silencedetect @ 0x1] silence_end: 3.3 | silence_duration: 1.5',
      '[silencedetect @ 0x1] silence_start: 4.3',
    ].join('\n');

    expect(parseSilencedetect(log)).toEqual([
      { start: 0, end: 0.8 },
      { start: 1.8, end: 3.3 },
      { start: 4.3, end: null },
    ]);
  });

  it('cuts edges and long gaps, keeping margins around the speech', () => {
    const spans = [
      { start: 0, end: 0.8 },
      { start: 1.8, end: 3.3 },
      { start: 4.3, end: null },
    ];

    expect(computeKeepRanges(spans, 5.5, params)).toEqual([
      [0.65, 1.95],
      [3.15, 4.45],
    ]);
    expect(computeKeepRanges(spans, 5.5, resolveTrimSilence({}))).toEqual([[0.65, 4.45]]);
    expect(computeKeepRanges(spans, 5.5, resolveTrimSilence({ edges: false, gaps: {} }))).toEqual([
      [0, 1.95],
      [3.15, 5.5],
    ]);
  });

  it('never cuts a pause shorter than minSilence, drops slivers, keeps an all-silent take whole', () => {
    expect(computeKeepRanges([{ start: 2, end: 2.4 }], 5, params)).toEqual([[0, 5]]);
    // The speech between the two pauses is 0.1 s: too short to keep.
    const sliver = computeKeepRanges(
      [
        { start: 1, end: 2 },
        { start: 2.1, end: 3 },
      ],
      4,
      { ...params, margin: 0 }
    );
    expect(sliver).toEqual([
      [0, 1],
      [3, 4],
    ]);
    expect(computeKeepRanges([{ start: 0, end: null }], 3, params)).toEqual([[0, 3]]);
  });

  it('clips explicit windows to the source and sums them', () => {
    expect(
      clipKeepRanges(
        [
          [0.5, 1.5],
          [3, 9],
        ],
        4
      )
    ).toEqual([
      [0.5, 1.5],
      [3, 4],
    ]);
    expect(clipKeepRanges([[5, 6]], 4)).toEqual([]);
    expect(
      keptDuration([
        [0.5, 1.5],
        [3, 4.25],
      ])
    ).toBe(2.25);
  });

  it('makes a trimmed section probe-dependent and a keep section known', () => {
    expect(knownDuration({ type: 'video', options: { duration: 5, trimSilence: {} } })).toBeUndefined();
    expect(
      knownDuration({
        type: 'video',
        options: {
          duration: 5,
          keep: [
            [0, 1],
            [2, 3.5],
          ],
        },
      })
    ).toBe(2.5);
    expect(knownDuration({ type: 'video', options: { duration: 2, keep: [[0, 3]] } })).toBe(2);
    expect(knownDuration({ type: 'video', options: { duration: 5 } })).toBe(5);
  });
});

describe('footage graph lowering', () => {
  const base: FootageGraphInput = {
    videoIn: 0,
    audioIn: '0:a',
    cutaways: [],
    scale: '640:360',
    frameFit: 'cover',
    audioFormat: { sampleRate: 44100, channelLayout: 'stereo' },
    audioChain: '',
    padAudio: false,
    length: 2,
    filtersList: ['setsar=1', 'scale=640:360', 'setparams=colorspace=bt709'],
    filtersMapList: [],
    mapsList: [],
  };

  it('is off for sections without edits', () => {
    expect(hasFootageGraph({ cutaways: [] })).toBe(false);
    expect(hasFootageGraph({ keep: [[0, 1]], cutaways: [] })).toBe(true);
  });

  it('cuts kept windows with trim/atrim + concat ahead of the section chain', () => {
    const args = footageFilterArgs({
      ...base,
      keep: [
        [0.5, 1.5],
        [3, 4],
      ],
      audioChain: 'afade=t=out:st=1.7:d=0.3',
    });

    expect(args).toBe(
      ' -filter_complex "' +
        '[0:v]trim=start=0.5:end=1.5,setpts=PTS-STARTPTS[fk0v];[0:a]atrim=start=0.5:end=1.5,asetpts=PTS-STARTPTS[fk0a];' +
        '[0:v]trim=start=3:end=4,setpts=PTS-STARTPTS[fk1v];[0:a]atrim=start=3:end=4,asetpts=PTS-STARTPTS[fk1a];' +
        '[fk0v][fk0a][fk1v][fk1a]concat=n=2:v=1:a=1[fkv][fka];' +
        '[fka]afade=t=out:st=1.7:d=0.3,atrim=duration=2[faout];' +
        '[fkv]setsar=1,scale=640:360,setparams=colorspace=bt709[fvout]" -map [fvout] -map [faout] '
    );
  });

  it('generates silence for a clip without audio and bounds a padded track', () => {
    const silent = footageFilterArgs({ ...base, keep: [[1, 2]], audioIn: null, length: undefined });

    expect(silent).toContain(
      '[0:v]trim=start=1:end=2,setpts=PTS-STARTPTS[fkv];anullsrc=r=44100:cl=stereo,atrim=duration=1[fka]'
    );
    expect(footageFilterArgs({ ...base, tonemap: true, padAudio: true })).toContain(
      '[0:a]apad=whole_dur=2,atrim=duration=2[faout]'
    );
  });

  it('tone-maps an HDR clip before the section chain', () => {
    expect(footageFilterArgs({ ...base, tonemap: true })).toContain(
      '[0:v]zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p[ftm];'
    );
  });

  it('overlays cutaways on the timeline and switches or mixes their audio', () => {
    const args = footageFilterArgs({
      ...base,
      cutaways: [
        { input: 1, at: 1, duration: 1, from: 0.5, audio: 'b', fit: 'cover' },
        { input: 2, at: 2.5, duration: 0.5, from: 0, audio: 'mix', fit: 'contain' },
      ],
    });

    expect(args).toContain(
      '[0:v]setpts=PTS-STARTPTS,scale=640:360:force_original_aspect_ratio=increase,crop=640:360,setsar=1[fm]'
    );
    expect(args).toContain(
      '[1:v]trim=start=0.5:duration=1,setpts=PTS-STARTPTS+1/TB,scale=640:360:force_original_aspect_ratio=increase'
    );
    expect(args).toContain("[fm][cw0]overlay=0:0:enable='between(t,1,2)':eof_action=pass[co0]");
    expect(args).toContain('pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1[cw1]');
    expect(args).toContain("[0:a]volume=volume=0:enable='between(t,1,2)'[fduck]");
    expect(args).toContain(
      'anullsrc=r=44100:cl=stereo,atrim=duration=1,aformat=sample_rates=44100:channel_layouts=stereo[cs0];[cs0][cb0]concat=n=2:v=0:a=1[cd0]'
    );
    expect(args).toContain('[fduck][cd0][cd1]amix=inputs=3:duration=first:normalize=0[fmix]');
    expect(args).toContain('[co1]setsar=1,scale=640:360');
    expect(args).not.toContain('adelay');
  });

  it('re-points a complex section graph at the edited clip, splitting when it is read twice', () => {
    const graph = {
      filtersMapList: ['[0:v]scale=640:360[a]', '[0:v]hflip[b]', '[a][b]overlay[out]'],
      mapsList: ['a', 'out'],
    };
    const args = footageFilterArgs({ ...base, ...graph, keep: [[0, 1]] });

    expect(args).toContain(
      '[fkv]split=2[fsv0][fsv1];[fsv0]scale=640:360[a];[fsv1]hflip[b];[a][b]overlay[out]" -map [out]'
    );
    expect(() =>
      footageFilterArgs({ ...base, filtersMapList: ['[2:v]null[x]'], mapsList: ['x'], keep: [[0, 1]] })
    ).toThrow(/read the main clip/);
  });
});

describe('footage validation', () => {
  const validator = new TemplateValidator();
  const errors = (sections: unknown[], global?: unknown) =>
    validator.validateTemplate({ global, sections } as never).errors ?? [];
  const codes = (sections: unknown[], global?: unknown) => errors(sections, global).map((error) => error.code);
  const clip = (extra: Record<string, unknown>) => ({
    type: 'video',
    name: 'clip',
    options: { duration: 4 },
    ...extra,
  });

  it('accepts the new vocabulary', () => {
    expect(
      errors([
        clip({
          look: { preset: 'teal-orange', strength: 0.6 },
          grade: { lut: { url: 'luts/log.cube', strength: 0.5 } },
          options: {
            duration: 4,
            keep: [
              [0, 1],
              [2, 3],
            ],
          },
          cues: { b: 1 },
          cutaways: [{ url: 'videos/broll.mp4', at: 'cue:b', duration: 1, audio: 'mix', fit: 'contain' }],
        }),
        { type: 'project_video', name: 'take', options: { trimSilence: { gaps: { minSilence: 0.8 } } } },
      ])
    ).toEqual([]);
  });

  it('flags strength on a non-LUT look, conflicting or empty trims, bad windows and cutaways', () => {
    expect(codes([clip({ look: { preset: 'warm', strength: 0.5 } })])).toContain('look_strength_unsupported');
    expect(codes([clip({})], { look: { preset: 'cinematic', strength: 0.2 } })).toContain('look_strength_unsupported');
    expect(codes([clip({ options: { duration: 4, keep: [[0, 1]], trimSilence: {} } })])).toContain(
      'keep_and_trim_silence'
    );
    expect(codes([clip({ options: { duration: 4, trimSilence: { edges: false } } })])).toContain('trim_silence_noop');
    expect(codes([clip({ options: { duration: 4, keep: [[2, 1]] } })])).toContain('keep_range_invalid');
    expect(
      codes([
        clip({
          options: {
            duration: 4,
            keep: [
              [0, 2],
              [1, 3],
            ],
          },
        }),
      ])
    ).toContain('keep_range_invalid');
    expect(
      codes([
        clip({
          cutaways: [
            { url: 'a.mp4', at: 1, duration: 2 },
            { url: 'b.mp4', at: 2, duration: 1 },
          ],
        }),
      ])
    ).toContain('cutaway_overlap');
    expect(codes([clip({ cutaways: [{ url: 'a.mp4', at: 3, duration: 2 }] })])).toContain('cutaway_out_of_range');
    expect(codes([{ ...clip({}), type: 'color_background', cutaways: [] }])).toContain('unknown_key');
  });

  it('rejects take edits combined with clip / speedRamp / freeze', () => {
    expect(codes([clip({ options: { duration: 4, keep: [[0, 1]], clip: { from: 1 } } })])).toContain(
      'take_edit_combination'
    );
    expect(
      codes([clip({ options: { duration: 4, speedRamp: 'hero' }, cutaways: [{ url: 'a.mp4', at: 1, duration: 1 }] })])
    ).toContain('take_edit_combination');
    expect(codes([clip({ options: { duration: 4, keep: [[0, 1]], fit: 'blur' } })])).not.toContain(
      'take_edit_combination'
    );
  });

  it('makes a beat reference after a trimmed take unresolvable', () => {
    const found = codes(
      [
        { type: 'project_video', name: 'take', options: { duration: 4, trimSilence: {} } },
        {
          type: 'color_background',
          name: 'end',
          options: { duration: 2 },
          graphics: [{ type: 'flash', at: 'beat:9' }],
        },
      ],
      { beats: { bpm: 120 } }
    );

    expect(found).toContain('unresolvable_time_ref');
  });

  it('advises that trimSilence is analysed on Node only', () => {
    const warnings = validator.getMotionWarnings({
      sections: [{ type: 'project_video', name: 't', options: { trimSilence: {} } }],
    });

    expect(warnings).toContainEqual(expect.objectContaining({ code: 'trim_silence_host_only', severity: 'info' }));
  });
});
