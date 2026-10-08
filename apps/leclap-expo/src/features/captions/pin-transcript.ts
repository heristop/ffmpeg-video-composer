// Pins an on-device transcript into the descriptor the app compiles: `subtitles.words` in section
// seconds, the `transcribe` request (and any authored cues / SRT it replaces) dropped, and the pin
// recorded under `meta.resolved.transcripts[section]` (engine, language, date, mean confidence) so a
// pinned transcript reads apart from authored captions. The device engine never transcribes: an
// unresolved `transcribe` fails its compile with transcribe_unavailable, so every request is pinned here.

import { meanConfidence, type TranscriptWord } from './transcript-mapping';

export interface TranscriptRecord {
  /** The section whose clip was transcribed. */
  from: string;
  engine: string;
  language?: string;
  model?: string;
  digest?: string;
  /** Fingerprint of the source section's edits (the engine's editFingerprint). */
  edit?: string;
  at?: string;
  confidence?: number;
}

interface PinOptions {
  /** The recogniser gave phrase timings only: karaoke degrades to phrase highlighting. */
  coarse?: boolean;
}

type Subtitles = Record<string, unknown>;

interface LooseSection {
  name?: string;
  subtitles?: Subtitles;
  [key: string]: unknown;
}

interface LooseDescriptor {
  meta?: Record<string, unknown>;
  sections?: LooseSection[];
  [key: string]: unknown;
}

function pinnedSubtitles(existing: Subtitles | undefined, words: TranscriptWord[], coarse: boolean): Subtitles {
  if (!existing) return { words, style: 'clean', karaoke: coarse ? false : 'word' };

  const { transcribe: _request, cues: _cues, srt: _srt, ...look } = existing;

  return { ...look, words, ...(coarse && { karaoke: false }) };
}

function withRecord(meta: Record<string, unknown> | undefined, name: string, record: TranscriptRecord) {
  const resolved = (meta?.resolved ?? {}) as { transcripts?: Record<string, TranscriptRecord> };

  return { ...meta, resolved: { ...resolved, transcripts: { ...resolved.transcripts, [name]: record } } };
}

export function pinTranscript<T extends LooseDescriptor>(
  descriptor: T,
  sectionName: string,
  words: TranscriptWord[],
  record: TranscriptRecord,
  options: PinOptions = {}
): T {
  const sections = descriptor.sections ?? [];

  if (!sections.some((section) => section.name === sectionName)) return descriptor;

  const confidence = meanConfidence(words);

  return {
    ...descriptor,
    meta: withRecord(descriptor.meta, sectionName, { ...record, ...(confidence !== undefined && { confidence }) }),
    sections: sections.map((section) =>
      section.name === sectionName
        ? { ...section, subtitles: pinnedSubtitles(section.subtitles, words, options.coarse ?? false) }
        : section
    ),
  };
}

export interface TranscribeRequestOf {
  /** The section that shows the captions. */
  section: string;
  /** The section whose clip it listens to (`transcribe.from`, "self" = its own). */
  source: string;
  language?: string;
}

/** Every `subtitles.transcribe` request of the descriptor, with the step it listens to. */
export function transcribeRequests(descriptor: LooseDescriptor): TranscribeRequestOf[] {
  return (descriptor.sections ?? []).flatMap((section) => {
    const request = section.subtitles?.transcribe as { from?: unknown; language?: unknown } | undefined;

    if (request === undefined || !section.name) return [];

    const from = typeof request.from === 'string' && request.from !== 'self' ? request.from : section.name;
    const language = typeof request.language === 'string' ? request.language : undefined;

    return [{ section: section.name, source: from, ...(language && { language }) }];
  });
}

/** The steps to open (each request's source clip, once) while the descriptor still asks for a transcription. */
export function unpinnedTranscriptions(descriptor: LooseDescriptor): string[] {
  return [...new Set(transcribeRequests(descriptor).map((request) => request.source))];
}
