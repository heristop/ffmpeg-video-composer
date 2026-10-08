import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import {
  LANGUAGE_TAG,
  LOW_TRANSCRIPT_CONFIDENCE,
  meanConfidence,
  transcribeMediaFile,
  transcriptSrt,
  type Transcript,
  type WhisperModelName,
} from 'ffmpeg-video-composer';
import { z } from 'zod';

import type { McpConfig } from '../config.js';
import { assertWithinMediaDir } from '../compose/pathGuard.js';

// transcribe_media: speech → word timings for captions, with whisper.cpp on this machine (the audio never
// leaves it). Returns the words (seconds into the file), an SRT, the language and the confidence, for the
// agent to pin into `subtitles.words` and have the words reviewed. The model is never downloaded from here:
// the operator opts in once (`leclap transcribe --download-model`, or LECLAP_WHISPER_DOWNLOAD=1 in the
// server's environment).

const inputSchema = z.object({
  path: z.string().describe('Absolute path of an audio or video file under the media dir.'),
  language: z
    .string()
    .regex(LANGUAGE_TAG)
    .optional()
    .describe('Spoken language, BCP-47 ("en", "fr"); omitted = detected.'),
  model: z.enum(['tiny', 'base', 'small']).optional().describe('Whisper model (default base; tiny is faster).'),
});

const wordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
});

const outputSchema = z.object({
  language: z.string().optional(),
  engine: z.string(),
  model: z.string().optional(),
  coarse: z.boolean().optional(),
  wordCount: z.number(),
  confidence: z.number().optional(),
  lowConfidence: z.boolean(),
  words: z.array(wordSchema),
  srt: z.string(),
  advice: z.string(),
});

type Args = z.infer<typeof inputSchema>;

export type MediaTranscriber = (
  realPath: string,
  options: { language?: string; model?: WhisperModelName; signal?: AbortSignal }
) => Promise<Transcript>;

function defaultTranscriber(...args: Parameters<MediaTranscriber>): ReturnType<MediaTranscriber> {
  return transcribeMediaFile(...args);
}

function advice(transcript: Transcript, low: boolean): string {
  const pin =
    'Pin the words into the section that plays this clip as subtitles.words (times are seconds into the file: ' +
    'subtract clip.from and account for speed edits, or put subtitles.transcribe on the section and let ' +
    'compose_video pin them).';
  const review = low
    ? ' Confidence is low: have the user review the words before rendering.'
    : ' Show the words to the user for a quick review before rendering.';
  const coarse = transcript.coarse
    ? ' Word times are spread over phrases (FFmpeg whisper filter): use karaoke false.'
    : '';

  return `${pin}${review}${coarse}`;
}

function errorResult(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}

async function handleTranscribe(args: Args, config: McpConfig, transcriber: MediaTranscriber, signal?: AbortSignal) {
  // Checked here too, not only by the input schema: the language reaches the transcriber's command line.
  if (args.language !== undefined && !LANGUAGE_TAG.test(args.language)) {
    return errorResult(`"${args.language}" is not a BCP-47 language tag (e.g. "en", "fr-FR").`);
  }

  let realPath: string;

  try {
    realPath = await assertWithinMediaDir(args.path, config.mediaDir);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }

  try {
    const transcript = await transcriber(realPath, { language: args.language, model: args.model, signal });
    const confidence = meanConfidence(transcript.words, 1) ?? undefined;
    const low = confidence !== undefined && confidence < LOW_TRANSCRIPT_CONFIDENCE;
    const result = {
      ...transcript,
      wordCount: transcript.words.length,
      ...(confidence === undefined ? {} : { confidence }),
      lowConfidence: low,
      srt: transcriptSrt(transcript.words),
      advice: advice(transcript, low),
    };
    const summary = `${transcript.words.length} words (${transcript.engine}, ${transcript.language ?? 'language unknown'})`;

    return {
      content: [{ type: 'text' as const, text: `Transcribed ${realPath}: ${summary}.` }],
      structuredContent: result,
    };
  } catch (error) {
    return errorResult(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function registerTranscribeMedia(
  server: McpServer,
  config: McpConfig,
  transcriber: MediaTranscriber = defaultTranscriber
) {
  server.registerTool(
    'transcribe_media',
    {
      title: 'Transcribe Media',
      description:
        'Transcribe the speech of a local audio/video file (absolute path under the media dir) with whisper.cpp on ' +
        'this machine: word timings { text, start, end, confidence } in seconds into the file, an SRT, the language ' +
        'and the mean confidence. Pin the words into subtitles.words (transcribe once, then pin), then have them ' +
        'reviewed. Needs whisper.cpp and a model the operator downloaded once (`leclap transcribe --download-model`).',
      inputSchema,
      outputSchema,
    },
    (args: Args, ctx?: ServerContext) => handleTranscribe(args, config, transcriber, ctx?.mcpReq.signal)
  );
}
