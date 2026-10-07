// Pure parsers for the QC measurements: the ffprobe JSON stream report and the stderr log of the one
// decode pass that runs blackdetect, freezedetect, silencedetect and ebur128. Kept free of IO so they
// are unit-tested on captured output and shared by the Node runner and the true-peak guard.

import type { QcContentMeasure, QcInterval, QcStreamProbe, QcVideoProbe } from './types';

interface ProbeStream {
  codec_type?: string;
  duration?: string;
  nb_read_frames?: string;
  nb_frames?: string;
  pix_fmt?: string;
  color_space?: string;
  color_primaries?: string;
  color_transfer?: string;
}

function toNumber(value: string | undefined): number | null {
  const parsed = value === undefined ? Number.NaN : Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function videoProbe(stream: ProbeStream): QcVideoProbe {
  return {
    duration: toNumber(stream.duration),
    frames: toNumber(stream.nb_read_frames ?? stream.nb_frames),
    pixFmt: stream.pix_fmt ?? null,
    colorSpace: stream.color_space ?? null,
    colorPrimaries: stream.color_primaries ?? null,
    colorTransfer: stream.color_transfer ?? null,
  };
}

/** `ffprobe -count_frames -show_entries stream=…:format=duration -of json` output. */
export function parseStreamProbe(stdout: string): QcStreamProbe {
  const data = JSON.parse(stdout) as { streams?: ProbeStream[]; format?: { duration?: string } };
  const streams = data.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');

  return {
    video: video ? videoProbe(video) : null,
    audio: audio ? { duration: toNumber(audio.duration) } : null,
    formatDuration: toNumber(data.format?.duration),
  };
}

// start/end pairs from a detector log; a start with no end (the condition lasted to EOF) closes at `end`.
function intervals(log: string, startKey: RegExp, endKey: RegExp, end: number): QcInterval[] {
  const events: Array<{ at: number; start: boolean; index: number }> = [];

  for (const match of log.matchAll(startKey)) events.push({ at: Number(match[1]), start: true, index: match.index });

  for (const match of log.matchAll(endKey)) events.push({ at: Number(match[1]), start: false, index: match.index });

  const found: QcInterval[] = [];
  let open: number | null = null;

  for (const event of events.sort((a, b) => a.index - b.index)) {
    if (event.start) open = event.at;

    if (!event.start && open !== null) {
      found.push({ start: open, end: event.at });
      open = null;
    }
  }

  if (open !== null && end > open) found.push({ start: open, end });

  return found;
}

function blackIntervals(log: string): QcInterval[] {
  return [...log.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((match) => ({
    start: Number(match[1]),
    end: Number(match[2]),
  }));
}

function lastNumber(log: string, pattern: RegExp): number | null {
  const match = [...log.matchAll(pattern)].at(-1);

  if (!match) return null;

  return match[1] === '-inf' ? Number.NEGATIVE_INFINITY : Number.parseFloat(match[1]);
}

/** Integrated loudness (LUFS) and true peak (dBTP) from the ebur128 summary at the end of a decode log. */
export function parseEbur128Summary(log: string): { integrated: number | null; truePeak: number | null } {
  const summary = log.slice(log.lastIndexOf('Summary:'));

  if (!log.includes('Summary:')) return { integrated: null, truePeak: null };

  return {
    integrated: lastNumber(summary, /\bI:\s+(-inf|-?[\d.]+)\s+LUFS/g),
    truePeak: lastNumber(summary, /\bPeak:\s+(-inf|-?[\d.]+)\s+dBFS/g),
  };
}

/** Every detector interval in the content-pass log; `duration` closes intervals still open at EOF. */
export function parseContentLog(log: string, duration: number, hasAudio: boolean): QcContentMeasure {
  const loudness = hasAudio ? parseEbur128Summary(log) : { integrated: null, truePeak: null };

  return {
    black: blackIntervals(log),
    freeze: intervals(log, /freeze_start:\s*([\d.]+)/g, /freeze_end:\s*([\d.]+)/g, duration),
    silence: hasAudio ? intervals(log, /silence_start:\s*(-?[\d.]+)/g, /silence_end:\s*([\d.]+)/g, duration) : [],
    ...loudness,
  };
}

/** Total seconds covered by the intervals. */
export function coveredSeconds(found: readonly QcInterval[]): number {
  return found.reduce((sum, interval) => sum + Math.max(0, interval.end - interval.start), 0);
}

/** The longest interval, in seconds. */
export function longestSeconds(found: readonly QcInterval[]): number {
  return found.reduce((longest, interval) => Math.max(longest, interval.end - interval.start), 0);
}
