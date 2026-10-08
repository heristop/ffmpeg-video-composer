// What a speech recogniser hands back, whatever runs it (whisper.cpp on Node, the OS recogniser on the
// phone): words timed in SOURCE seconds of the clip it heard, the language, and how it was produced.

import type { TranscribeRequest } from '../../schemas/transcribe.schemas';
import type { TranscriptWord } from './transcript-time';

export type { TranscriptWord } from './transcript-time';

export interface Transcript {
  words: TranscriptWord[];
  /** Language spoken, as requested or detected (BCP-47 / ISO 639-1). */
  language?: string;
  /** Recogniser id: whisper.cpp, ffmpeg-whisper, ios-speech, android-speech… */
  engine: string;
  model?: string;
  /** True when only phrases were timed and the word times are spread by character count. */
  coarse?: boolean;
}

/** A host's recogniser: transcribes one media file. */
export type Transcriber = (file: string, request: TranscribeRequest & { signal?: AbortSignal }) => Promise<Transcript>;
