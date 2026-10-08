import { z } from 'zod';

// ── auto-captions: transcribe once, then pin ───────────────────────────────────────
//
// `subtitles.transcribe` asks for the section's speech as word timings. It is a resolve request, never
// part of a render: the Node pass (`leclap transcribe`, the transcribe_media MCP tool or `leclap render`)
// replaces it with `subtitles.words` and records how in `meta.resolved.transcripts[section]`; the
// browser and on-device engines report transcribe_unavailable (the app pins words itself, on the phone).

export const TRANSCRIBE_MODELS = ['tiny', 'base', 'small'] as const;

/** A BCP-47 language tag ("en", "fr-FR", "zh-Hant-TW"): letters, digits and hyphens only, since it reaches the
 * transcriber's command line and FFmpeg's filtergraph. */
export const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export const TranscribeSchema = z
  .object({
    from: z
      .string()
      .min(1)
      .optional()
      .describe('Whose speech: "self" (default, this section\'s own clip) or the name of a video section.'),
    language: z
      .string()
      .min(2)
      .max(35)
      .regex(LANGUAGE_TAG, 'a BCP-47 language tag such as "en" or "fr-FR"')
      .optional()
      .describe('Spoken language as BCP-47 ("en", "fr-FR"); omitted = detected, then recorded in the pin.'),
    model: z
      .enum(TRANSCRIBE_MODELS)
      .optional()
      .describe('Whisper model on Node: tiny (fast) or base (default, more accurate) or small.'),
  })
  .strict()
  .describe(
    "Transcribe this section's speech into word timings. Resolved once, before rendering, into `words` " +
      '(Node: `leclap transcribe`); the browser and on-device engines need the words pinned.'
  );

export const TranscriptRecordSchema = z
  .object({
    from: z.string().describe('The section whose clip was transcribed.'),
    engine: z.string().describe('Recogniser that produced the words: whisper.cpp, ios-speech, android-speech…'),
    model: z.string().optional().describe('Model the engine used (whisper: tiny, base, small).'),
    language: z.string().optional().describe('Language spoken, as requested or detected.'),
    digest: z
      .string()
      .optional()
      .describe('sha256:<hex> of the source clip; a different clip makes the pin stale (transcript_stale).'),
    edit: z
      .string()
      .optional()
      .describe(
        "Fingerprint of the source section's edits (clip, keep, trimSilence, speedRamp, freeze, speed, duration) " +
          'the words were mapped through; different edits now report transcript_edit_changed.'
      ),
    at: z.string().optional().describe('When the words were pinned (ISO 8601).'),
    confidence: z.number().min(0).max(1).optional().describe('Mean word confidence, 0..1.'),
  })
  .strict()
  .describe("How a section's pinned words were transcribed.");

export const ResolvedRecordsSchema = z
  .object({
    transcripts: z
      .record(z.string(), TranscriptRecordSchema)
      .optional()
      .describe('Pinned transcripts by section name, written by the transcription pass.'),
  })
  .strict()
  .describe('What resolve passes pinned into this descriptor; renders only read the pinned values.');

export type TranscribeRequest = z.infer<typeof TranscribeSchema>;
export type TranscriptRecord = z.infer<typeof TranscriptRecordSchema>;
