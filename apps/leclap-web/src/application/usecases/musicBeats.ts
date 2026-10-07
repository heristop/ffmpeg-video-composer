import type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import { applyMusicAnalysis, type MusicAnalysis } from 'ffmpeg-video-composer/src/core/audio/apply-analysis.ts';
import { isAnalysisRequest } from 'ffmpeg-video-composer/src/core/timing/timeline.ts';
import { findMusicBeats } from '@leclap/creative-kit/music-beats';

// The beat grid of the picked music: a library track's precomputed analysis (creative-kit
// music-beats.generated.json), or — for an upload, or a library track the table does not have — the
// engine's analyzer run in the browser on the decoded audio (lazy-loaded with the decoder). It fills
// global.beats and the drop cue only where the template left them out (core/audio/apply-analysis.ts),
// so "beat:n", "bar:n" and "cue:drop" land on the music even though the WASM engine cannot measure it.

/** Writes an analysis into the descriptor in place (the builder mutates the descriptor it compiles). */
export function applyAnalysisInPlace(descriptor: TemplateDescriptor, analysis: MusicAnalysis): void {
  const updated = applyMusicAnalysis(descriptor, analysis);

  descriptor.global = updated.global;
  descriptor.sections = updated.sections;
}

/** global.beats + drop cue from the library table, when it has the track. */
export function applyLibraryBeats(descriptor: TemplateDescriptor, trackId: string): void {
  const analysis = findMusicBeats(trackId);

  if (analysis) applyAnalysisInPlace(descriptor, analysis);
}

/** Whether the descriptor would take a measured grid: none authored, or `{ analyze: 'music' }`. */
export function wantsBeatAnalysis(descriptor: TemplateDescriptor): boolean {
  const beats = descriptor.global?.beats;

  return beats === undefined || isAnalysisRequest(beats);
}

export interface MusicBytesSource {
  getBytes(key: string): Promise<Uint8Array | null>;
}

const MEDIA_PREFIX = 'media://';

// The audio of the descriptor's music: an upload from the media store, else (only when the template asked
// for an analysis) the same-origin library file.
async function musicBytes(descriptor: TemplateDescriptor, source: MusicBytesSource): Promise<ArrayBuffer | null> {
  const url = descriptor.global?.music?.url;

  if (url?.startsWith(MEDIA_PREFIX)) {
    const bytes = await source.getBytes(url.slice(MEDIA_PREFIX.length));

    // A copy: decodeAudioData detaches the buffer it is handed.
    return bytes ? new Uint8Array(bytes).buffer : null;
  }

  if (!url || !isAnalysisRequest(descriptor.global?.beats)) return null;

  const response = await fetch(url);

  return response.ok ? response.arrayBuffer() : null;
}

/**
 * Measures the music in the browser and fills the grid when the template wants one. Never throws: when
 * the audio cannot be decoded, a `{ analyze: 'music' }` request stays and validation reports it.
 */
export async function analyzeMusicInBrowser(descriptor: TemplateDescriptor, source: MusicBytesSource): Promise<void> {
  if (!wantsBeatAnalysis(descriptor) || !descriptor.global?.music) return;

  try {
    const bytes = await musicBytes(descriptor, source);

    if (!bytes) return;

    const { analyzeAudioBytes } = await import('./browserMusicAnalysis');

    applyAnalysisInPlace(descriptor, await analyzeAudioBytes(bytes));
  } catch (error) {
    console.warn('[Beats] music analysis skipped:', error);
  }
}
