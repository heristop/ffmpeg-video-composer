import { describe, expect, it } from 'vitest';
import { durationTolerance, evaluateQc } from '@/core/qc/evaluate';
import { parseContentLog, parseEbur128Summary, parseStreamProbe } from '@/core/qc/parse';
import type { QcExpectations, QcMeasurements, QcStreamProbe } from '@/core/qc/types';
import { contentPassArgs, wantsQc } from '@/services/qc-node';

const expected: QcExpectations = { durationSeconds: 4, fps: 30, audioExpected: true, normalize: null };

function probe(
  overrides: Partial<NonNullable<QcStreamProbe['video']>> = {},
  audio: number | null = 4.01
): QcStreamProbe {
  return {
    video: {
      duration: 4,
      frames: 120,
      pixFmt: 'yuv420p',
      colorSpace: 'bt709',
      colorPrimaries: 'bt709',
      colorTransfer: 'bt709',
      ...overrides,
    },
    audio: audio === null ? null : { duration: audio },
    formatDuration: 4.01,
  };
}

function statuses(measurements: QcMeasurements, plan: QcExpectations = expected): Record<string, string> {
  return Object.fromEntries(evaluateQc(measurements, plan).findings.map((finding) => [finding.check, finding.status]));
}

const EBUR128_TAIL = `
[Parsed_ebur128_1 @ 0x6000] Summary:

  Integrated loudness:
    I:         -16.3 LUFS
    Threshold: -26.5 LUFS

  Loudness range:
    LRA:         2.1 LU

  True peak:
    Peak:       -1.2 dBFS
`;

describe('QC parsers', () => {
  it('reads streams, frame counts and colour tags from ffprobe JSON', () => {
    const parsed = parseStreamProbe(
      JSON.stringify({
        streams: [
          { codec_type: 'video', duration: '2.000000', nb_read_frames: '60', pix_fmt: 'yuv420p', color_space: 'bt709' },
          { codec_type: 'audio', duration: '2.023220' },
        ],
        format: { duration: '2.023220' },
      })
    );

    expect(parsed.video).toMatchObject({
      duration: 2,
      frames: 60,
      pixFmt: 'yuv420p',
      colorSpace: 'bt709',
      colorTransfer: null,
    });
    expect(parsed.audio).toEqual({ duration: 2.02322 });
    expect(parsed.formatDuration).toBeCloseTo(2.02322);
  });

  it('pairs detector events and closes an interval still open at the end', () => {
    const log = [
      '[blackdetect @ 0x1] black_start:0 black_end:0.5 black_duration:0.5',
      '[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 1',
      '[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 1.5',
      '[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 2.5',
      '[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 3.2',
      '[silencedetect @ 0x3] silence_start: -0.0213',
      '[silencedetect @ 0x3] silence_end: 1.2 | silence_duration: 1.22',
      EBUR128_TAIL,
    ].join('\n');

    const content = parseContentLog(log, 4, true);

    expect(content.black).toEqual([{ start: 0, end: 0.5 }]);
    expect(content.freeze).toEqual([
      { start: 1, end: 2.5 },
      { start: 3.2, end: 4 },
    ]);
    expect(content.silence).toEqual([{ start: -0.0213, end: 1.2 }]);
    expect(content).toMatchObject({ integrated: -16.3, truePeak: -1.2 });
  });

  it('reads -inf for digital silence and nothing without a summary', () => {
    expect(parseEbur128Summary('Summary:\n I: -70.0 LUFS\n Peak: -inf dBFS')).toEqual({
      integrated: -70,
      truePeak: Number.NEGATIVE_INFINITY,
    });
    expect(parseEbur128Summary('no audio here')).toEqual({ integrated: null, truePeak: null });
  });
});

describe('QC verdict', () => {
  it('uses max(1.5 frames, 50 ms) as the duration tolerance', () => {
    expect(durationTolerance(30)).toBeCloseTo(0.05);
    expect(durationTolerance(24)).toBeCloseTo(0.0625);
  });

  it('verifies a file matching the plan', () => {
    const report = evaluateQc({ probe: probe() }, expected);

    expect(report).toMatchObject({ verified: true, content: false });
    expect(Object.values(statuses({ probe: probe() }))).toEqual(Array(6).fill('pass'));
  });

  it('fails a short file, missing frames, drift, a wrong pixel format and missing sound', () => {
    expect(statuses({ probe: probe({ duration: 3.8 }) }).duration).toBe('fail');
    expect(statuses({ probe: probe({ frames: 117 }) }).frame_count).toBe('fail');
    expect(statuses({ probe: probe({ frames: 121 }) }).frame_count).toBe('pass');
    expect(statuses({ probe: probe({}, 3.8) }).av_drift).toBe('fail');
    expect(statuses({ probe: probe({ pixFmt: 'yuv444p' }) }).pixel_format).toBe('fail');
    expect(statuses({ probe: probe({}, null) }).audio_present).toBe('fail');
    expect(statuses({ probe: probe({}, null) }, { ...expected, audioExpected: false }).audio_present).toBe('pass');
  });

  it('warns on untagged colour, which keeps the render from verifying', () => {
    const report = evaluateQc({ probe: probe({ colorPrimaries: null }) }, expected);

    expect(report.findings.find((finding) => finding.check === 'color_tags')).toMatchObject({
      status: 'warn',
      value: 'bt709/unknown/bt709',
    });
    expect(report.verified).toBe(false);
  });

  it('never passes a measurement that could not be taken', () => {
    const report = evaluateQc({ probe: null, probeError: 'no ffprobe available', content: null }, expected);

    expect(report.verified).toBe(false);
    expect(report.findings).toHaveLength(11);
    expect(report.findings.every((finding) => finding.status === 'warn')).toBe(true);
    expect(report.findings.every((finding) => finding.reason.startsWith('not checked'))).toBe(true);
  });

  it('grades content as judgement: black share, longest freeze, silence and loudness', () => {
    const content = {
      black: [{ start: 0, end: 0.8 }],
      freeze: [{ start: 1, end: 2.5 }],
      silence: [{ start: 0, end: 2.4 }],
      integrated: -23,
      truePeak: 0.4,
    };
    const report = evaluateQc({ probe: probe(), content }, expected);
    const byCheck = Object.fromEntries(report.findings.map((finding) => [finding.check, finding]));

    expect(byCheck.black_frames).toMatchObject({ status: 'warn', value: 0.2, kind: 'judgement' });
    expect(byCheck.frozen_frames).toMatchObject({ status: 'pass', value: 1.5 });
    expect(byCheck.silence).toMatchObject({ status: 'warn', value: 0.6 });
    expect(byCheck.loudness).toMatchObject({ status: 'pass', value: -23, expected: null });
    expect(byCheck.true_peak).toMatchObject({ status: 'warn', kind: 'judgement' });
    // Judgement findings inform; they never decide `verified`.
    expect(report.verified).toBe(true);
  });

  it('fails a nearly all-black video and warns on a long freeze', () => {
    const content = {
      black: [{ start: 0, end: 3.9 }],
      freeze: [{ start: 0, end: 3.5 }],
      silence: [],
      integrated: null,
      truePeak: null,
    };
    const findings = statuses({ probe: probe(), content });

    expect(findings.black_frames).toBe('fail');
    expect(findings.frozen_frames).toBe('warn');
  });

  it('holds loudnorm renders to the target, and the true peak becomes a format check', () => {
    const plan: QcExpectations = { ...expected, normalize: 'loudnorm' };
    const content = { black: [], freeze: [], silence: [], integrated: -19, truePeak: -1.2 };
    const report = evaluateQc({ probe: probe(), content }, plan);
    const byCheck = Object.fromEntries(report.findings.map((finding) => [finding.check, finding]));

    expect(byCheck.loudness).toMatchObject({ status: 'warn', expected: -16 });
    expect(byCheck.true_peak).toMatchObject({ status: 'warn', kind: 'format' });
    expect(report.verified).toBe(false);
  });

  it('reports the true-peak guard result without the content pass', () => {
    const plan: QcExpectations = { ...expected, normalize: 'loudnorm' };
    const loudness = {
      filter: 'loudnorm' as const,
      target: -1.5,
      ceiling: -2.4,
      measured: -1.6,
      retries: 1,
      attempts: [
        { ceiling: -1.5, measured: -0.8 },
        { ceiling: -2.4, measured: -1.6 },
      ],
    };
    const report = evaluateQc({ probe: probe(), loudness }, plan);

    expect(report.findings.at(-1)).toMatchObject({ check: 'true_peak', status: 'pass', kind: 'format', value: -1.6 });
    expect(report.findings.at(-1)?.reason).toContain('ceiling -2.4 dBTP after 1 retries');
  });
});

describe('QC runner options', () => {
  it('runs only when asked', () => {
    expect(wantsQc(undefined)).toBe(false);
    expect(wantsQc(false)).toBe(false);
    expect(wantsQc(true)).toBe(true);
    expect(wantsQc({ content: true })).toBe(true);
  });

  it('decodes once, with the audio detectors only when there is audio', () => {
    const args = contentPassArgs('/out.mp4', true).join(' ');

    expect(args).toContain('-vf blackdetect=d=0.1:pix_th=0.10,freezedetect=n=-60dB:d=0.5');
    expect(args).toContain('-af silencedetect=n=-50dB:d=0.5,ebur128=peak=true:framelog=verbose');
    expect(contentPassArgs('/out.mp4', false).join(' ')).not.toContain('-af');
  });
});
