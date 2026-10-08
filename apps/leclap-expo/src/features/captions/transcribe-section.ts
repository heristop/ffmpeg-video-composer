// Transcribes a section's recorded clip with the OS recogniser, on the device only (iOS
// SFSpeechRecognizer with requiresOnDeviceRecognition, Android's on-device SpeechRecognizer): audio
// never leaves the phone, and when on-device recognition is unavailable this refuses rather than
// falling back to a server. The result is mapped to section seconds and ready to pin.

import type { SectionCaptions } from './caption-store';
import {
  mapTranscriptWords,
  spreadSegments,
  type MappingContext,
  type SectionTimeEdits,
  type TranscriptSegment,
  type TranscriptWord,
} from './transcript-mapping';

export interface SpeechAvailability {
  available: boolean;
  onDevice: boolean;
  reason?: string;
}

export interface NativeTranscript {
  language: string;
  words: TranscriptWord[];
  /** Phrase timings, when the recogniser gave no per-word timings. */
  segments?: TranscriptSegment[];
  segmentsOnly: boolean;
  /** sha256 of the transcribed file ("sha256:<hex>"). */
  digest?: string;
}

/** The native leclap-speech module (modules/leclap-speech), injected for tests. */
export interface SpeechEngine {
  isAvailable(language?: string): Promise<SpeechAvailability>;
  requestPermission(): Promise<boolean>;
  transcribeFile(uri: string, options: { language: string }): Promise<NativeTranscript>;
}

export type TranscriptionErrorCode = 'unavailable' | 'permission' | 'empty';

export class TranscriptionError extends Error {
  constructor(
    readonly code: TranscriptionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

interface TranscribeArgs {
  speech: SpeechEngine;
  /** The section whose clip is transcribed (recorded as the pin's `from`). */
  source: string;
  clipPath: string;
  language: string;
  platform: 'ios' | 'android';
  options?: SectionTimeEdits;
  mapping?: MappingContext;
  now?: () => Date;
}

const REGION: Record<string, string> = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT' };

/** A recogniser locale for an app language ("fr" → "fr-FR"); full tags pass through. */
export function speechLocale(language: string | undefined): string {
  if (!language) return 'en-US';

  return REGION[language] ?? language;
}

/** The recogniser locale: the template's `subtitles.transcribe.language` first, then the device's. */
export function captionLanguage(requested: string | undefined, device: string | undefined): string {
  return speechLocale(requested ?? device);
}

async function assertReady(speech: SpeechEngine, language: string): Promise<void> {
  const availability = await speech.isAvailable(language);

  if (!availability.available || !availability.onDevice) {
    throw new TranscriptionError('unavailable', availability.reason ?? 'On-device speech recognition is unavailable');
  }

  if (!(await speech.requestPermission())) {
    throw new TranscriptionError('permission', 'Speech recognition permission denied');
  }
}

export async function transcribeSection(args: TranscribeArgs): Promise<SectionCaptions> {
  const { speech, clipPath, language, platform } = args;

  await assertReady(speech, language);

  const transcript = await speech.transcribeFile(clipPath, { language });
  const timed = transcript.segmentsOnly ? spreadSegments(transcript.segments ?? []) : transcript.words;
  const words = mapTranscriptWords(timed, args.options, args.mapping);

  if (words.length === 0) throw new TranscriptionError('empty', 'No speech was recognised in this clip');

  return {
    words,
    coarse: transcript.segmentsOnly,
    clipPath,
    record: {
      from: args.source,
      engine: `${platform}-speech`,
      language: transcript.language || language,
      ...(transcript.digest && { digest: transcript.digest }),
      at: (args.now ?? (() => new Date()))().toISOString(),
    },
  };
}
