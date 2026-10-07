import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { X264_COLOR_PARAMS, buildColorMetadataArgs, ffmpegAtLeast } from '@/core/encoding';
import { tapFFmpegCommands } from '@/core/determinism/command-tap';
import { computePlanHash } from '@/core/determinism/plan-hash';
import { buildAudioFadeArg } from '@/editor/utils/audio-fade';
import { loudnormFilter, musicMixGraph } from '@/editor/utils/music-mix';
import { nextCeiling, normalizeWithTruePeakGuard } from '@/editor/utils/true-peak-guard';
import { discardOutput, publishOutput, resolveOutputPaths } from '@/director/output-staging';
import { qcExpectations } from '@/director/qc-expectations';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import type AbstractFilesystem from '@/platform/filesystem/AbstractFilesystem';
import { versionFromLine } from '@/platform/ffmpeg/analyze-node';
import { commandInputFiles } from '@/services/command-inputs-node';
import { sectionCacheKey } from '@/services/section-cache-node';
import { assertOutputIsNotInput } from '@/services/render-setup-node';
import type { ProjectBuildInfos, ProjectConfig, Section } from '@/core/types';

describe('colour tags by FFmpeg version', () => {
  const x264 = { codecConfig: { videoCodec: '' } } as ProjectConfig;

  it('parses release, n-prefixed and suffixed versions; git snapshots are unknown', () => {
    expect(ffmpegAtLeast('7.1', 7, 1)).toBe(true);
    expect(ffmpegAtLeast('n7.1.1', 7, 1)).toBe(true);
    expect(ffmpegAtLeast('8.1-static', 7, 1)).toBe(true);
    expect(ffmpegAtLeast('7.0.2', 7, 1)).toBe(false);
    expect(ffmpegAtLeast('6.1.1-3ubuntu5', 7, 1)).toBe(false);
    expect(ffmpegAtLeast('N-118000-g1234abcd', 7, 1)).toBe(false);
    expect(ffmpegAtLeast(null, 7, 1)).toBe(false);
    expect(versionFromLine('ffmpeg version 7.1.1 Copyright (c) 2000-2025')).toBe('7.1.1');
  });

  it('tags through libx264 on 7.1+, and keeps the output flags everywhere else', () => {
    const flags = '-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv';

    expect(buildColorMetadataArgs(x264, '7.1')).toBe(X264_COLOR_PARAMS);
    expect(buildColorMetadataArgs({ codecConfig: { videoCodec: 'libx264' } }, '8.1')).toBe(X264_COLOR_PARAMS);
    expect(buildColorMetadataArgs(x264, '6.1.1')).toBe(flags);
    // Unknown version (WASM core, on-device engine, dry run): historical flags.
    expect(buildColorMetadataArgs(x264, null)).toBe(flags);
    expect(buildColorMetadataArgs({ codecConfig: { videoCodec: 'libopenh264' } }, '8.1')).toBe(flags);
    expect(buildColorMetadataArgs({ codecConfig: { videoCodec: 'h264_videotoolbox' } }, '8.1')).toBe(flags);
    expect(buildColorMetadataArgs()).toBe(flags);
  });
});

describe('true-peak guard', () => {
  it('lowers the ceiling by the overshoot plus 0.2 dB', () => {
    expect(nextCeiling(-1.5, -0.9)).toBe(-2.3);
    expect(nextCeiling(-8, 2)).toBe(-9);
  });

  it('runs once when the encoded peak holds', async () => {
    const run = vi.fn(async () => undefined);
    const report = await normalizeWithTruePeakGuard({ run, measure: async () => -1.45 });

    expect(run).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ ceiling: -1.5, measured: -1.45, retries: 0 });
  });

  it('re-runs with a lowered ceiling at most twice and reports every pass', async () => {
    const run = vi.fn(async (_ceiling: number) => undefined);
    const peaks = [-0.9, -1.3, -1.35];
    const report = await normalizeWithTruePeakGuard({ run, measure: async () => peaks.shift() ?? null });

    expect(run.mock.calls.map(([ceiling]) => ceiling)).toEqual([-1.5, -2.3, -2.7]);
    expect(report).toMatchObject({ ceiling: -2.7, measured: -1.35, retries: 2 });
    expect(report.attempts).toEqual([
      { ceiling: -1.5, measured: -0.9 },
      { ceiling: -2.3, measured: -1.3 },
      { ceiling: -2.7, measured: -1.35 },
    ]);
  });

  it('stops after the first pass when the peak cannot be measured', async () => {
    const run = vi.fn(async () => undefined);
    const report = await normalizeWithTruePeakGuard({
      run,
      measure: async () => {
        throw new Error('no audio');
      },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(report.measured).toBeNull();
    expect(await normalizeWithTruePeakGuard({ run })).toMatchObject({ measured: null, retries: 0 });
  });

  it('threads the ceiling into the loudnorm filter of the music mix', () => {
    const graph = musicMixGraph({
      global: { audio: { normalize: 'loudnorm' } },
      musicFilters: [],
      multipleSegments: false,
      audioVolumeLevel: 1,
      reduceNoiseConfig: 'afftdn',
      channelConfig: 'aformat=sample_fmts=fltp',
      hasSegmentAudio: true,
      ceiling: -2.3,
    });

    expect(loudnormFilter()).toBe('loudnorm=I=-16:TP=-1.5:LRA=11');
    expect(graph).toContain('amix=inputs=2:duration=first,loudnorm=I=-16:TP=-2.3:LRA=11[final]');
  });
});

describe('A/V length equalisation', () => {
  it('pads a clip’s own audio so -shortest cuts at the video', () => {
    expect(buildAudioFadeArg({ duration: 3 }, true)).toBe(' -af "apad" ');
    expect(buildAudioFadeArg({ duration: 3, audioFade: { out: { duration: 1 } } }, true)).toBe(
      ' -af "afade=t=out:st=2:d=1,apad" '
    );
    expect(buildAudioFadeArg({ duration: 3 })).toBe('');
    expect(buildAudioFadeArg({ duration: 3, muteSection: true }, true)).toBe('');
  });
});

describe('atomic output staging', () => {
  const nodeAdapter = { binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' } } as unknown as AbstractFFmpeg;
  const dryRun = { binaries: null } as unknown as AbstractFFmpeg;
  const wasm = { binaries: null, usesVirtualFilesystem: true } as unknown as AbstractFFmpeg;

  it('stages next to the output on the CLI adapters only', () => {
    expect(resolveOutputPaths('/b', nodeAdapter)).toEqual({ staging: '/b/output.partial.mp4', final: '/b/output.mp4' });
    expect(resolveOutputPaths('/b', dryRun)).toEqual({ staging: '/b/output.mp4', final: '/b/output.mp4' });
    expect(resolveOutputPaths('/b', wasm).staging).toBe('/b/output.mp4');
  });

  it('renames a completed build onto the output and removes a failed one', async () => {
    const fsAdapter = {
      move: vi.fn(async () => undefined),
      stat: vi.fn(async () => true),
      unlink: vi.fn(async () => undefined),
    } as unknown as AbstractFilesystem;
    const paths = { staging: '/b/output.partial.mp4', final: '/b/output.mp4' };

    expect(await publishOutput(fsAdapter, paths, paths.staging)).toBe('/b/output.mp4');
    expect(fsAdapter.move).toHaveBeenCalledWith('/b/output.partial.mp4', '/b/output.mp4');
    expect(await publishOutput(fsAdapter, paths, null)).toBeNull();

    await discardOutput(fsAdapter, paths);
    expect(fsAdapter.unlink).toHaveBeenCalledWith('/b/output.partial.mp4');

    // Without staging, a failed build never deletes the (previous) output.
    vi.mocked(fsAdapter.unlink).mockClear();
    await discardOutput(fsAdapter, { staging: '/b/output.mp4', final: '/b/output.mp4' });
    expect(fsAdapter.unlink).not.toHaveBeenCalled();
  });

  it('refuses an output that is one of the inputs', () => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-guard-'));
    const clip = path.join(buildDir, 'output.mp4');
    fs.writeFileSync(clip, '');

    expect(() => assertOutputIsNotInput(buildDir, { userVideoPaths: { intro: clip } }, {})).toThrow(
      /Refusing to render: the output .* is also an input/
    );
    expect(() =>
      assertOutputIsNotInput(buildDir, { userVideoPaths: { intro: path.join(buildDir, 'in.mp4') } }, {})
    ).not.toThrow();
    fs.rmSync(buildDir, { recursive: true, force: true });
  });
});

describe('command tap interception', () => {
  it('records the profiled command, then lets the interceptor decide whether FFmpeg runs', async () => {
    const execute = vi.fn(async () => ({ rc: 0 }));
    const adapter = { execute } as unknown as AbstractFFmpeg;
    const recorded: string[] = [];
    const intercept = vi.fn(async () => ({ rc: 0 }));
    const restore = tapFFmpegCommands(adapter, { deterministic: true, onCommand: (c) => recorded.push(c), intercept });

    await adapter.execute('-y -i a.mp4 -c:v h264 /build/s_output.mp4');
    restore();

    expect(recorded).toHaveLength(1);
    expect(intercept).toHaveBeenCalledWith(recorded[0], expect.any(Function));
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('section cache key and plan hash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-key-'));
  const font = path.join(dir, 'fonts', 'A.ttf');
  fs.mkdirSync(path.dirname(font), { recursive: true });
  fs.writeFileSync(font, 'font-a');
  const command = ` -y -f lavfi -i color=c=red -vf "drawtext=text='x':fontfile='${font}'" ${dir}/s_output.mp4 `;
  const options = { dir, buildDir: dir, roots: { buildDir: dir }, ffmpegVersionLine: 'ffmpeg version 6.1' };

  it('reads the files named inside filter arguments', () => {
    expect(commandInputFiles(command)).toEqual([font]);
  });

  it('changes with the input bytes and the FFmpeg build, not with the machine path', async () => {
    const base = await sectionCacheKey(command, options);

    expect(await sectionCacheKey(command, options)).toBe(base);
    expect(await sectionCacheKey(command, { ...options, ffmpegVersionLine: 'ffmpeg version 8.1' })).not.toBe(base);

    fs.writeFileSync(font, 'font-b');
    expect(await sectionCacheKey(command, options)).not.toBe(base);
  });

  it('hashes the plan over sorted, de-duplicated digests', () => {
    const plan = {
      descriptor: { b: 1, a: 2 },
      encoder: { tier: 'standard' },
      engineVersion: '2.5.0',
      ffmpegVersion: 'x',
    };

    expect(computePlanHash({ ...plan, assetDigests: ['b', 'a'], fontDigests: ['f', 'f'] })).toBe(
      computePlanHash({ ...plan, descriptor: { a: 2, b: 1 }, assetDigests: ['a', 'b'], fontDigests: ['f'] })
    );
    expect(computePlanHash({ ...plan, assetDigests: [], fontDigests: [] })).not.toBe(
      computePlanHash({ ...plan, assetDigests: [], fontDigests: [], ffmpegVersion: 'y' })
    );
  });
});

describe('QC expectations', () => {
  const buildInfos = (patch: Partial<ProjectBuildInfos>): ProjectBuildInfos =>
    ({ durations: {}, sourceHasAudio: {}, transitions: [], musicPath: '', ...patch }) as ProjectBuildInfos;

  it('subtracts the capped xfade overlaps and trims clips to their declared length', () => {
    const sections = [
      { name: 'a', type: 'project_video', options: { duration: 3 } },
      { name: 'b', type: 'color_background', options: { duration: 1 } },
      { name: 'c', type: 'color_background', options: { duration: 2 } },
    ] as Section[];
    const plan = qcExpectations(
      sections,
      buildInfos({
        durations: { a: 5, b: 1, c: 2 },
        sourceHasAudio: { a: true },
        transitions: [
          { type: 'fade', duration: 0.8 },
          { type: 'cut', duration: 0 },
        ],
      }),
      undefined,
      30
    );

    // 3 + 1 + 2 − min(0.8, 1/2); a cut inside the xfade assembly is a concat, with no overlap.
    expect(plan.durationSeconds).toBeCloseTo(5.5);
    expect(plan.audioExpected).toBe(true);
  });

  it('expects sound only when music resolves or a clip brings it', () => {
    const sections = [{ name: 'a', type: 'color_background', options: { duration: 1 } }] as Section[];

    expect(qcExpectations(sections, buildInfos({}), { musicEnabled: true }, 30).audioExpected).toBe(false);
    expect(
      qcExpectations(sections, buildInfos({ musicPath: '/m.mp3' }), { musicEnabled: true }, 30).audioExpected
    ).toBe(true);
  });
});
