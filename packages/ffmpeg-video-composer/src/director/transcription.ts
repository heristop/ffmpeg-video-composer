// The transcription resolve pass: every `subtitles.transcribe` request is transcribed from its source
// clip, mapped from clip seconds to section seconds through the section's edits
// (core/captions/transcript-time.ts) and pinned (core/captions/transcript-pin.ts). Host-agnostic: the
// Node entry registers a transcriber (services/transcribe-node); elsewhere validation already reported
// transcribe_unavailable. Used by the director at compile time and by `leclap transcribe`.

import { transcribeTargets, type TranscribeTarget } from '@/core/captions/transcribe-requests';
import { editFingerprint, pinTranscript } from '@/core/captions/transcript-pin';
import { mapTranscriptWords, type TranscriptEdit } from '@/core/captions/transcript-time';
import type { Transcriber, Transcript } from '@/core/captions/transcript';
import { meanConfidence } from '../services/transcript-advisories';
import type { TranscriptRecord } from '../schemas/transcribe.schemas';

export interface TranscriptionDeps {
  transcribe: Transcriber;
  /** Local file of a section's clip, or null when it has none. */
  sourceOf: (sectionName: string) => Promise<string | null>;
  /** The edits between the source section's clip and its timeline. */
  editOf: (section: { name: string; type?: string; options?: unknown }) => TranscriptEdit | Promise<TranscriptEdit>;
  /** Only pin these sections (default: every request). */
  sections?: readonly string[];
  /** sha256:<hex> of a clip file. */
  digestOf: (file: string) => Promise<string>;
  /** ISO date of the pin. */
  now?: () => string;
  signal?: AbortSignal;
}

export interface TranscriptPin {
  section: string;
  record: TranscriptRecord;
  words: number;
}

type LooseDescriptor = { meta?: unknown; sections?: unknown };
type LooseSection = { name: string; type?: string; options?: unknown; subtitles?: Record<string, unknown> };

// What a pin records of the clip it came from: the source section, its clip digest and its edits.
type PinSource = { name: string; digest: string; edit: string };

function recordOf(transcript: Transcript, source: PinSource, at: string | undefined, words: Transcript['words']) {
  const confidence = meanConfidence(words, 1);
  const record: TranscriptRecord = {
    from: source.name,
    engine: transcript.engine,
    ...(transcript.model === undefined ? {} : { model: transcript.model }),
    ...(transcript.language === undefined ? {} : { language: transcript.language }),
    digest: source.digest,
    ...(at === undefined ? {} : { at }),
    ...(confidence === null ? {} : { confidence }),
    edit: source.edit,
  };

  return record;
}

async function resolveOne<T extends LooseDescriptor>(descriptor: T, target: TranscribeTarget, deps: TranscriptionDeps) {
  const sections = descriptor.sections as LooseSection[];
  const sourceName = target.source as string;
  const file = await deps.sourceOf(sourceName);

  if (!file) throw new Error(`transcribe: section "${target.name}" listens to "${sourceName}", which has no clip`);

  const transcript = await deps.transcribe(file, { ...target.request, ...(deps.signal && { signal: deps.signal }) });
  const source = sections[target.sourceIndex];
  const words = mapTranscriptWords(transcript.words, await deps.editOf(source));
  // The compile path never reads the clock (a render must repeat byte for byte): a pin carries a time only
  // when the caller injects one, as `leclap transcribe` does.
  const at = deps.now?.();
  const record = recordOf(
    transcript,
    { name: sourceName, digest: await deps.digestOf(file), edit: editFingerprint(source.options) },
    at,
    words
  );
  // Phrase-timed words would flash karaoke on guessed boundaries: highlight phrases instead.
  const extra = transcript.coarse ? { karaoke: false } : {};

  return {
    descriptor: pinTranscript(descriptor, target.index, words, record, extra),
    pin: { section: target.name, record, words: words.length },
  };
}

/** The descriptor with every transcription request pinned (the input is returned as-is without any). */
export async function resolveTranscripts<T extends LooseDescriptor>(
  descriptor: T,
  deps: TranscriptionDeps
): Promise<{ descriptor: T; pins: TranscriptPin[] }> {
  const only = deps.sections;
  const targets = transcribeTargets(descriptor).filter((target) => !only || only.includes(target.name));
  // One clip at a time: each pin builds on the previous descriptor, and transcriptions never compete.
  return targets.reduce(
    async (pending, target) => {
      const done = await pending;

      if (target.source === null) throw new Error(`transcribe: section "${target.name}" has no clip to transcribe`);

      const resolved = await resolveOne(done.descriptor, target, deps);

      return { descriptor: resolved.descriptor, pins: [...done.pins, resolved.pin] };
    },
    Promise.resolve({ descriptor, pins: [] as TranscriptPin[] })
  );
}
