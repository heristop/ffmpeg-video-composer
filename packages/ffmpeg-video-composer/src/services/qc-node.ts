// Node half of the output QC (`ProjectConfig.qc`): probe the rendered file with the adapter's own
// ffprobe, optionally decode it once through the content detectors, and hand the measurements to the
// pure verdict in core/qc/evaluate.ts. A measurement that fails is reported, never skipped silently.

import type { FFmpegBinaries } from '../platform/ffmpeg/AbstractFFmpeg';
import { runMeasurement } from '../platform/ffmpeg/analyze-node';
import { evaluateQc } from '@/core/qc/evaluate';
import { parseContentLog, parseStreamProbe } from '@/core/qc/parse';
import type {
  LoudnessReport,
  QcExpectations,
  QcMeasurements,
  QcOption,
  QcReport,
  QcStreamProbe,
} from '@/core/qc/types';

// Detector settings: black at ≤10% luma for ≥0.1 s, frozen when frames differ by less than -60 dB for
// ≥0.5 s, silent under -50 dBFS for ≥0.5 s; ebur128 with true-peak metering, per-frame log muted.
export const BLACKDETECT = 'blackdetect=d=0.1:pix_th=0.10';
export const FREEZEDETECT = 'freezedetect=n=-60dB:d=0.5';
export const SILENCEDETECT = 'silencedetect=n=-50dB:d=0.5';
export const EBUR128 = 'ebur128=peak=true:framelog=verbose';

export interface QcRunInput {
  file: string;
  option: QcOption;
  expectations: QcExpectations | null;
  binaries: FFmpegBinaries | null;
  loudness?: LoudnessReport | null;
}

export function wantsQc(option: QcOption | undefined): option is QcOption {
  return option === true || typeof option === 'object';
}

function wantsContent(option: QcOption): boolean {
  return typeof option === 'object' && option.content === true;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PROBE_ENTRIES =
  'stream=codec_type,duration,nb_read_frames,pix_fmt,color_space,color_primaries,color_transfer:format=duration';

async function probe(ffprobe: string, file: string): Promise<QcStreamProbe> {
  const args = ['-v', 'error', '-count_frames', '-show_entries', PROBE_ENTRIES, '-of', 'json', file];

  return parseStreamProbe((await runMeasurement(ffprobe, args)).stdout);
}

/** The single decode pass: video detectors on the first video stream, audio ones on the first audio stream. */
export function contentPassArgs(file: string, hasAudio: boolean): string[] {
  const video = ['-map', '0:v:0', '-vf', `${BLACKDETECT},${FREEZEDETECT}`];
  const audio = hasAudio ? ['-map', '0:a:0', '-af', `${SILENCEDETECT},${EBUR128}`] : [];

  return ['-hide_banner', '-nostats', '-i', file, ...video, ...audio, '-f', 'null', '-'];
}

async function measureProbe(input: QcRunInput, measurements: QcMeasurements): Promise<void> {
  const ffprobe = input.binaries?.ffprobe;

  if (!ffprobe) {
    measurements.probeError = 'no ffprobe available to this FFmpeg adapter';

    return;
  }

  try {
    measurements.probe = await probe(ffprobe, input.file);
  } catch (error) {
    measurements.probeError = `ffprobe failed: ${message(error)}`;
  }
}

async function measureContent(input: QcRunInput, measurements: QcMeasurements, duration: number): Promise<void> {
  const ffmpeg = input.binaries?.ffmpeg;
  measurements.content = null;

  if (!ffmpeg) {
    measurements.contentError = 'no ffmpeg binary available to decode the output';

    return;
  }

  // Without a probe, assume an audio track exists: the decode fails loudly if it doesn't.
  const hasAudio = measurements.probe ? measurements.probe.audio !== null : true;

  try {
    const { stderr } = await runMeasurement(ffmpeg, contentPassArgs(input.file, hasAudio));
    measurements.content = parseContentLog(stderr, duration, hasAudio);
  } catch (error) {
    measurements.contentError = `decode pass failed: ${message(error)}`;
  }
}

const UNKNOWN_EXPECTATIONS: QcExpectations = { durationSeconds: 0, fps: 30, audioExpected: false, normalize: null };

/** Probes (and with `{ content: true }` decodes) the rendered file and returns the QC report. */
export async function runOutputQc(input: QcRunInput): Promise<QcReport> {
  const expectations = input.expectations ?? UNKNOWN_EXPECTATIONS;
  const measurements: QcMeasurements = { probe: null, loudness: input.loudness ?? null };

  await measureProbe(input, measurements);

  if (wantsContent(input.option)) {
    const probed = measurements.probe?.video?.duration ?? measurements.probe?.formatDuration ?? null;
    await measureContent(input, measurements, probed ?? expectations.durationSeconds);
  }

  return evaluateQc(measurements, expectations);
}
