import { requireOptionalNativeModule } from 'expo';

// On-device speech recognition for auto-captions: iOS SFSpeechRecognizer with
// requiresOnDeviceRecognition, Android's on-device SpeechRecognizer (API 33+). Audio never leaves the
// device; when on-device recognition is unavailable the calls refuse instead of using a server.

export interface SpeechAvailability {
  available: boolean;
  onDevice: boolean;
  reason?: string;
}

export interface SpeechWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface SpeechTranscript {
  language: string;
  words: SpeechWord[];
  /** Phrase timings when the recogniser gave no per-word timings. */
  segments?: Array<{ text: string; start: number; end: number }>;
  segmentsOnly: boolean;
  /** sha256 of the transcribed file ("sha256:<hex>"). */
  digest?: string;
}

interface LeclapSpeechNativeModule {
  isAvailable(language: string | null): Promise<SpeechAvailability>;
  requestPermission(): Promise<{ granted?: boolean } | boolean>;
  transcribeFile(uri: string, options: { language: string }): Promise<SpeechTranscript>;
}

// Optional: a build without the module (web, or an app binary older than the module) reports
// unavailable instead of crashing on import.
const Native = requireOptionalNativeModule<LeclapSpeechNativeModule>('LeclapSpeech');

const MISSING = 'This app build has no on-device speech module; rebuild the app to enable captions.';

export async function isAvailable(language?: string): Promise<SpeechAvailability> {
  if (!Native) return { available: false, onDevice: false, reason: MISSING };

  return Native.isAvailable(language ?? null);
}

export async function requestPermission(): Promise<boolean> {
  if (!Native) return false;

  const result = await Native.requestPermission();

  return typeof result === 'boolean' ? result : Boolean(result.granted);
}

export async function transcribeFile(uri: string, options: { language: string }): Promise<SpeechTranscript> {
  if (!Native) throw new Error(MISSING);

  return Native.transcribeFile(uri, options);
}
