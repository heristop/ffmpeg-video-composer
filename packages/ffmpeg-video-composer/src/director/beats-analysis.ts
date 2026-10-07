// `global.beats: { analyze: 'music' }` at compile time: once the music track is resolved to a local file
// (MusicComposer.loadMusic), the analyzer the host registered measures it and the analysed grid (plus the
// drop cue) goes into the descriptor before the time-reference pass. Only the Node entry registers an
// analyzer (services/beats-analysis-node.ts); elsewhere the build stops with beats_analysis_unavailable,
// which validation already reports on those hosts.

import type AbstractLogger from '../platform/logging/AbstractLogger';
import { applyMusicAnalysis, type MusicAnalysis } from '@/core/audio/apply-analysis';
import { isAnalysisRequest } from '@/core/timing/timeline';

/** DI token of the host's music analyzer. */
export const BEATS_ANALYZER = 'beatsAnalyzer';

export type BeatsAnalyzer = (file: string, options: { beatsPerBar?: number }) => Promise<MusicAnalysis>;

/** Whether the descriptor's time references wait for a music analysis. */
export function awaitsBeatsAnalysis(descriptor: { global?: unknown }): boolean {
  return isAnalysisRequest((descriptor.global as { beats?: unknown } | undefined)?.beats);
}

// tsyringe is loaded on use: this module sits in the build-preparation graph that validation-only callers
// import without the reflect-metadata polyfill.
async function registered(): Promise<{ analyzer: BeatsAnalyzer | null; logger: AbstractLogger }> {
  const { container } = await import('tsyringe');
  const analyzer = container.isRegistered(BEATS_ANALYZER) ? container.resolve<BeatsAnalyzer>(BEATS_ANALYZER) : null;

  return { analyzer, logger: container.resolve<AbstractLogger>('logger') };
}

/** The descriptor with its requested grid measured from `musicPath`. Throws when that is impossible. */
export async function analyzeTemplateMusic<T extends { global?: unknown; sections?: unknown }>(
  descriptor: T,
  musicPath: string | null | undefined
): Promise<T> {
  const { analyzer, logger } = await registered();

  if (!analyzer) {
    throw new Error(
      'beats_analysis_unavailable: global.beats { analyze: "music" } needs the Node compile; precompute the grid ' +
        'with `leclap beats <audio> --json` or the analyze_music MCP tool'
    );
  }

  if (!musicPath) throw new Error('global.beats { analyze: "music" } needs a music track (global.music)');

  const request = (descriptor.global as { beats?: { beatsPerBar?: number } }).beats;
  const analysis = await analyzer(musicPath, { beatsPerBar: request?.beatsPerBar });

  logger.info(
    `[Beats] ${analysis.bpm} BPM, beat 1 at ${analysis.offset}s, confidence ${analysis.confidence}` +
      (analysis.cues.drop === undefined ? '' : `, drop at ${analysis.cues.drop}s`)
  );

  if (!analysis.usable) {
    logger.warn('[Beats] beat_grid_low_confidence: the music has no reliable pulse; pace it by phrases, not beats');
  }

  return applyMusicAnalysis(descriptor, analysis);
}
