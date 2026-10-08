// The director's transcription step, once the clips are probed and the take plans resolved (so trimmed
// silences are known): every `subtitles.transcribe` request is transcribed by the host's transcription
// service and pinned (director/transcription.ts), onto the descriptor and onto the sections the build
// renders; pinned transcripts whose clip changed are reported as transcript_stale, those whose section was
// re-cut since as transcript_edit_changed. Only the Node entry registers a service; elsewhere validation
// already stopped the build with transcribe_unavailable.

import type { KeepRange, Section } from '@/core/types';
import type { Transcriber } from '@/core/captions/transcript';
import { awaitsTranscription } from '@/core/captions/transcribe-requests';
import { staleTranscripts, transcriptRecords } from '@/core/captions/transcript-pin';
import { sectionTranscriptEdit } from '@/core/captions/transcript-time';
import { resolveTranscripts, type TranscriptPin } from './transcription';

/** DI token of the host's transcription service. */
export const TRANSCRIPTION_SERVICE = 'transcriptionService';

export interface TranscriptionService {
  transcribe: Transcriber;
  /** sha256:<hex> of a clip file. */
  digest: (file: string) => Promise<string>;
}

export interface TranscribeSectionsDeps {
  service: TranscriptionService | null;
  sourceOf: (sectionName: string) => Promise<string | null>;
  fps: number;
  buildInfos: {
    sourceDurations?: Record<string, number>;
    footage?: Record<string, { keep?: KeepRange[] } | undefined>;
  };
  logger: { info: (message: string) => void; warn: (message: string) => void };
  /** The render's cancellation: aborting it stops the transcriber (whisper is killed). */
  signal?: AbortSignal;
}

function logPin(pin: TranscriptPin, logger: TranscribeSectionsDeps['logger']): void {
  const { record } = pin;
  const how = [[record.engine, record.model].filter(Boolean).join(' '), record.language].filter(Boolean).join(', ');
  const confidence = record.confidence === undefined ? '' : `, confidence ${record.confidence}`;
  const words = `${pin.words} word${pin.words === 1 ? '' : 's'}`;

  logger.info(
    `[Transcribe] ${pin.section}: pinned ${words} (${how}${confidence}); ` +
      'run `leclap transcribe` to keep them in the template'
  );
}

// Clip digests are measured only with a transcription service (Node); edit changes need none.
async function currentDigests(sources: string[], deps: TranscribeSectionsDeps): Promise<Record<string, string>> {
  const service = deps.service;

  if (!service) return {};

  const digests = await Promise.all(
    sources.map(async (source) => {
      const file = await deps.sourceOf(source);

      return file ? [[source, await service.digest(file)] as const] : [];
    })
  );

  return Object.fromEntries(digests.flat());
}

async function warnStale(descriptor: unknown, deps: TranscribeSectionsDeps): Promise<void> {
  const sources = [...new Set(Object.values(transcriptRecords(descriptor)).map((record) => record.from))];

  if (sources.length === 0) return;

  const current = await currentDigests(sources, deps);

  for (const warning of staleTranscripts(descriptor, current)) deps.logger.warn(`[${warning.code}] ${warning.message}`);
}

/** The descriptor with its transcription requests pinned (sections updated in place); stale pins warned. */
export async function transcribeSections<T extends { meta?: unknown; sections?: unknown }>(
  descriptor: T,
  sections: Section[],
  deps: TranscribeSectionsDeps
): Promise<T> {
  if (!awaitsTranscription(descriptor)) {
    await warnStale(descriptor, deps);

    return descriptor;
  }

  const service = deps.service;

  if (!service) {
    throw new Error(
      'transcribe_unavailable: subtitles.transcribe needs the Node transcription pass; pin the words first'
    );
  }

  const { descriptor: pinned, pins } = await resolveTranscripts(descriptor, {
    transcribe: service.transcribe,
    digestOf: service.digest,
    sourceOf: deps.sourceOf,
    editOf: (section) =>
      sectionTranscriptEdit(section, {
        fps: deps.fps,
        lengths: deps.buildInfos.sourceDurations,
        keep: deps.buildInfos.footage?.[section.name]?.keep,
      }),
    ...(deps.signal && { signal: deps.signal }),
  });

  for (const pin of pins) {
    const target = sections.find((section) => section.name === pin.section);
    const resolved = (pinned.sections as Section[] | undefined)?.find((section) => section.name === pin.section);

    if (target && resolved) target.subtitles = resolved.subtitles;

    logPin(pin, deps.logger);
  }

  return pinned;
}
