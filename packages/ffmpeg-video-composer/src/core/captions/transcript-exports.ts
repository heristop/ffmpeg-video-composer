// The platform-neutral half of auto-captions, exported by every entry (Node, browser, React Native): the
// on-device app pins its OS recogniser's words with the same mapping, pin record and advisories as Node.
export { mapTranscriptWords, transcriptEditFor, type TranscriptEdit, type TranscriptWord } from './transcript-time';
export { transcriptSrt } from './transcript-srt';
export { editFingerprint, pinTranscript, staleTranscripts, transcriptRecords } from './transcript-pin';
export {
  awaitsTranscription,
  transcribeTargets,
  CLIP_SECTION_TYPES,
  type TranscribeTarget,
} from './transcribe-requests';
export type { Transcript, Transcriber } from './transcript';
export { meanConfidence, LOW_TRANSCRIPT_CONFIDENCE } from '../../services/transcript-advisories';
export {
  LANGUAGE_TAG,
  TRANSCRIBE_MODELS,
  TranscribeSchema,
  TranscriptRecordSchema,
  type TranscribeRequest,
  type TranscriptRecord,
} from '../../schemas/transcribe.schemas';
