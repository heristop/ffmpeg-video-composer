// Node-only music analysis: decode a track with FFmpeg (platform/ffmpeg/decode-pcm-node.ts) and run the
// platform-neutral beat analyzer on it (core/audio/beats.ts). Behind `leclap beats`, the analyze_music
// MCP tool and the compile-time resolution of `global.beats: { analyze: 'music' }` (registered as the
// director's beats analyzer by the Node entry).

import { container } from 'tsyringe';
import { analyzeBeats, type BeatAnalysis } from '../core/audio/beats';
import { decodeMonoPcm } from '../platform/ffmpeg/decode-pcm-node';
import type AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import { BEATS_ANALYZER, type BeatsAnalyzer } from '../director/beats-analysis';

export interface AnalyzeMusicOptions {
  /** FFmpeg binary (default `ffmpeg` on PATH). */
  ffmpeg?: string;
  /** Beats per bar for the downbeat estimate (default 4). */
  beatsPerBar?: number;
  /** Analyze at most this many seconds of the track. */
  maxSeconds?: number;
  signal?: AbortSignal;
}

/** Tempo, beat grid, confidence and drop/build/end cues of an audio file. Deterministic. */
export async function analyzeMusicFile(file: string, options: AnalyzeMusicOptions = {}): Promise<BeatAnalysis> {
  const { samples, sampleRate } = await decodeMonoPcm(file, options);

  return analyzeBeats(samples, sampleRate, { beatsPerBar: options.beatsPerBar });
}

/**
 * Registers the compile-time analyzer behind `global.beats: { analyze: 'music' }`, decoding with the
 * binary of the FFmpeg adapter the bridge selected (system FFmpeg or ffmpeg-static).
 */
export function registerBeatsAnalyzer(): void {
  container.registerInstance<BeatsAnalyzer>(BEATS_ANALYZER, analyzeWithAdapterBinary);
}

function analyzeWithAdapterBinary(file: string, options: { beatsPerBar?: number }): Promise<BeatAnalysis> {
  const ffmpeg = container.resolve<AbstractFFmpeg>('ffmpegAdapter').binaries?.ffmpeg;

  return analyzeMusicFile(file, { ...options, ffmpeg });
}
