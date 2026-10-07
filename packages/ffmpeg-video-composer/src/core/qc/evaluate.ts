// The QC verdict: compares what was measured on the rendered file with what the plan says it should be.
// Pure. A measurement that could not be taken never passes silently: it becomes a `warn` that says the
// check did not run, which also keeps the render from counting as `verified`.

import { coveredSeconds, longestSeconds } from './parse';
import { LOUDNORM_INTEGRATED, LOUDNORM_TRUE_PEAK } from './targets';
import type {
  LoudnessReport,
  QcContentMeasure,
  QcExpectations,
  QcFinding,
  QcInterval,
  QcKind,
  QcMeasurements,
  QcReport,
  QcStreamProbe,
} from './types';

/** Black covering more than this share of the video warns; at least FAIL_SHARE fails. */
export const BLACK_WARN_SHARE = 0.1;
export const BLACK_FAIL_SHARE = 0.95;
/** A frozen stretch longer than max(FREEZE_MIN_SECONDS, FREEZE_SHARE × duration) warns. */
export const FREEZE_MIN_SECONDS = 3;
export const FREEZE_SHARE = 0.3;
/** Silence covering more than this share warns when the plan expects sound. */
export const SILENCE_WARN_SHARE = 0.5;
export { LOUDNORM_INTEGRATED, LOUDNORM_TRUE_PEAK };

const COLOR_TAG = 'bt709';

function finding(
  check: string,
  kind: QcKind,
  result: Pick<QcFinding, 'status' | 'value' | 'expected' | 'reason'>
): QcFinding {
  return { check, kind, ...result };
}

function notChecked(check: string, kind: QcKind, why: string): QcFinding {
  return finding(check, kind, { status: 'warn', value: null, expected: null, reason: `not checked: ${why}` });
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Duration tolerance: one and a half frames, never under 50 ms. */
export function durationTolerance(fps: number): number {
  return Math.max(1.5 / fps, 0.05);
}

function videoDuration(probe: QcStreamProbe): number | null {
  return probe.video?.duration ?? probe.formatDuration;
}

function checkDuration(probe: QcStreamProbe, expected: QcExpectations): QcFinding {
  const measured = videoDuration(probe);

  if (measured === null) return notChecked('duration', 'format', 'the file reports no duration');

  if (expected.durationSeconds <= 0) return notChecked('duration', 'format', 'the plan has no expected duration');

  const tolerance = durationTolerance(expected.fps);
  const off = Math.abs(measured - expected.durationSeconds);

  return finding('duration', 'format', {
    status: off <= tolerance ? 'pass' : 'fail',
    value: round3(measured),
    expected: round3(expected.durationSeconds),
    reason: `${round3(off)}s off the planned length (tolerance ${round3(tolerance)}s)`,
  });
}

function checkFrameCount(probe: QcStreamProbe, expected: QcExpectations): QcFinding {
  const frames = probe.video?.frames ?? null;

  if (frames === null) return notChecked('frame_count', 'format', 'the frame count could not be read');

  const planned = Math.round(expected.durationSeconds * expected.fps);
  const tolerance = Math.floor(durationTolerance(expected.fps) * expected.fps);

  return finding('frame_count', 'format', {
    status: Math.abs(frames - planned) <= tolerance ? 'pass' : 'fail',
    value: frames,
    expected: planned,
    reason: `${frames - planned} frames against duration × ${expected.fps} fps (tolerance ${tolerance})`,
  });
}

function checkDrift(probe: QcStreamProbe, expected: QcExpectations): QcFinding {
  const video = probe.video?.duration ?? null;
  const audio = probe.audio?.duration ?? null;

  if (!probe.audio) {
    return finding('av_drift', 'format', { status: 'pass', value: null, expected: 0, reason: 'no audio stream' });
  }

  if (video === null || audio === null) return notChecked('av_drift', 'format', 'a stream reports no duration');

  const drift = audio - video;
  const tolerance = durationTolerance(expected.fps);

  return finding('av_drift', 'format', {
    status: Math.abs(drift) <= tolerance ? 'pass' : 'fail',
    value: round3(drift),
    expected: 0,
    reason: `audio ends ${round3(drift)}s after video (tolerance ${round3(tolerance)}s)`,
  });
}

function checkPixelFormat(probe: QcStreamProbe): QcFinding {
  const pixFmt = probe.video?.pixFmt ?? null;

  if (pixFmt === null) return notChecked('pixel_format', 'format', 'no pixel format reported');

  return finding('pixel_format', 'format', {
    status: pixFmt === 'yuv420p' ? 'pass' : 'fail',
    value: pixFmt,
    expected: 'yuv420p',
    reason: pixFmt === 'yuv420p' ? 'plays everywhere' : 'players and browsers expect 8-bit 4:2:0',
  });
}

function checkColorTags(probe: QcStreamProbe): QcFinding {
  const video = probe.video;
  const tags = [video?.colorSpace, video?.colorPrimaries, video?.colorTransfer].map((tag) => tag ?? 'unknown');
  const tagged = tags.every((tag) => tag === COLOR_TAG);

  return finding('color_tags', 'format', {
    status: tagged ? 'pass' : 'warn',
    value: tags.join('/'),
    expected: `${COLOR_TAG}/${COLOR_TAG}/${COLOR_TAG}`,
    reason: tagged ? 'Rec.709 matrix, primaries and transfer' : 'untagged or non-Rec.709 colour can shift in players',
  });
}

function checkAudioPresent(probe: QcStreamProbe, expected: QcExpectations): QcFinding {
  const present = probe.audio !== null;
  const missing = expected.audioExpected && !present;

  return finding('audio_present', 'format', {
    status: missing ? 'fail' : 'pass',
    value: present ? 'present' : 'absent',
    expected: expected.audioExpected ? 'present' : 'any',
    reason: missing ? 'music or clip sound was planned but the file has no audio' : 'audio stream as planned',
  });
}

function formatFindings(measurements: QcMeasurements, expected: QcExpectations): QcFinding[] {
  const probe = measurements.probe;
  const checks = ['duration', 'frame_count', 'av_drift', 'pixel_format', 'color_tags', 'audio_present'];

  if (!probe) {
    return checks.map((check) => notChecked(check, 'format', measurements.probeError ?? 'the stream probe failed'));
  }

  return [
    checkDuration(probe, expected),
    checkFrameCount(probe, expected),
    checkDrift(probe, expected),
    checkPixelFormat(probe),
    checkColorTags(probe),
    checkAudioPresent(probe, expected),
  ];
}

// Share of the video a set of intervals covers; audio can run a frame past the video, so cap at 1.
function share(intervals: readonly QcInterval[], duration: number): number {
  return duration > 0 ? Math.min(1, coveredSeconds(intervals) / duration) : 0;
}

function shareStatus(share: number, warnAbove: number, failFrom: number): QcFinding['status'] {
  if (share >= failFrom) return 'fail';

  return share > warnAbove ? 'warn' : 'pass';
}

function checkBlack(content: QcContentMeasure, duration: number): QcFinding {
  const black = share(content.black, duration);

  return finding('black_frames', 'judgement', {
    status: shareStatus(black, BLACK_WARN_SHARE, BLACK_FAIL_SHARE),
    value: round3(black),
    expected: `<= ${BLACK_WARN_SHARE}`,
    reason: `${Math.round(black * 100)}% of the video is black`,
  });
}

function checkFreeze(content: QcContentMeasure, duration: number): QcFinding {
  const longest = longestSeconds(content.freeze);
  const limit = Math.max(FREEZE_MIN_SECONDS, FREEZE_SHARE * duration);

  return finding('frozen_frames', 'judgement', {
    status: longest > limit ? 'warn' : 'pass',
    value: round3(longest),
    expected: `<= ${round3(limit)}`,
    reason: `longest unchanging stretch ${round3(longest)}s (a static card may be intended)`,
  });
}

function checkSilence(content: QcContentMeasure, duration: number, expected: QcExpectations): QcFinding {
  const silent = share(content.silence, duration);
  const warn = expected.audioExpected && silent > SILENCE_WARN_SHARE;

  return finding('silence', 'judgement', {
    status: warn ? 'warn' : 'pass',
    value: round3(silent),
    expected: expected.audioExpected ? `<= ${SILENCE_WARN_SHARE}` : 'any',
    reason: `${Math.round(silent * 100)}% of the audio is silent`,
  });
}

function checkLoudness(content: QcContentMeasure, expected: QcExpectations): QcFinding {
  const integrated = content.integrated;

  if (integrated === null) {
    return finding('loudness', 'judgement', { status: 'pass', value: null, expected: null, reason: 'no audio' });
  }

  const target =
    expected.normalize === 'loudnorm' ? (expected.loudnessTarget?.integrated ?? LOUDNORM_INTEGRATED) : null;
  const off = target === null ? 0 : Math.abs(integrated - target);

  return finding('loudness', 'judgement', {
    status: off > 2 ? 'warn' : 'pass',
    value: integrated,
    expected: target,
    reason: target === null ? 'integrated loudness (LUFS)' : `${round3(off)} LU from the loudnorm target`,
  });
}

function checkTruePeak(truePeak: number | null, expected: QcExpectations, loudness?: LoudnessReport | null): QcFinding {
  const normalized = expected.normalize === 'loudnorm';
  const kind: QcKind = normalized ? 'format' : 'judgement';
  const ceiling = normalized ? (loudness?.target ?? expected.loudnessTarget?.truePeak ?? LOUDNORM_TRUE_PEAK) : 0;

  if (truePeak === null) {
    return finding('true_peak', kind, { status: 'pass', value: null, expected: null, reason: 'no audio' });
  }

  const over = truePeak > ceiling + 0.1;
  const used = loudness ? ` (loudnorm ceiling ${loudness.ceiling} dBTP after ${loudness.retries} retries)` : '';

  return finding('true_peak', kind, {
    status: over ? 'warn' : 'pass',
    value: Number.isFinite(truePeak) ? truePeak : '-inf',
    expected: `<= ${ceiling}`,
    reason: `${over ? 'above' : 'within'} the ${ceiling} dBTP ceiling${used}`,
  });
}

// Without the content pass, the true peak the loudnorm guard measured on the encoded file stands in.
function guardTruePeak(loudness: LoudnessReport, expected: QcExpectations): QcFinding {
  if (loudness.measured === null) {
    return notChecked('true_peak', 'format', 'the encoded true peak could not be measured');
  }

  return checkTruePeak(loudness.measured, expected, loudness);
}

function contentFindings(measurements: QcMeasurements, expected: QcExpectations): QcFinding[] {
  const content = measurements.content;
  const checks: Array<[string, QcKind]> = [
    ['black_frames', 'judgement'],
    ['frozen_frames', 'judgement'],
    ['silence', 'judgement'],
    ['loudness', 'judgement'],
    ['true_peak', expected.normalize === 'loudnorm' ? 'format' : 'judgement'],
  ];

  if (!content) {
    const why = measurements.contentError ?? 'the decode pass failed';

    return checks.map(([check, kind]) => notChecked(check, kind, why));
  }

  const duration = measurements.probe ? (videoDuration(measurements.probe) ?? expected.durationSeconds) : 0;

  return [
    checkBlack(content, duration || expected.durationSeconds),
    checkFreeze(content, duration || expected.durationSeconds),
    checkSilence(content, duration || expected.durationSeconds, expected),
    checkLoudness(content, expected),
    checkTruePeak(content.truePeak, expected, measurements.loudness),
  ];
}

/** Findings for the measurements, and `verified` when every `format` finding passed. */
export function evaluateQc(measurements: QcMeasurements, expected: QcExpectations): QcReport {
  const content = measurements.content !== undefined;
  const findings = [...formatFindings(measurements, expected)];

  if (content) findings.push(...contentFindings(measurements, expected));

  if (!content && measurements.loudness) findings.push(guardTruePeak(measurements.loudness, expected));

  return {
    verified: findings.filter((item) => item.kind === 'format').every((item) => item.status === 'pass'),
    content,
    findings,
  };
}
