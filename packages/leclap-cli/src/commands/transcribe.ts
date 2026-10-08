import { defineCommand } from 'citty';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  transcribeMediaFile,
  transcribeTemplate,
  transcriptSrt,
  type Transcript,
  type TranscriptPin,
  type WhisperModelName,
} from 'ffmpeg-video-composer';
import { fail, heading, hint, step, success } from '../ui.js';
import { wordmark } from '../theme.js';
import { collectRepeated, parseKeyValues } from '../render-args.js';

// `leclap transcribe <template|media>`: speech → word-timed captions with whisper.cpp, locally.
// - A template: every `subtitles.transcribe` request is transcribed from its section's clip and pinned
//   into `subtitles.words` (+ meta.resolved.transcripts), written back in place or to --out.
// - A media file: its words, language and SRT are printed (--json / --srt).
// The model is downloaded once, only with --download-model.

const MODELS: readonly WhisperModelName[] = ['tiny', 'base', 'small'];

interface Flags {
  input: string;
  section?: string;
  language?: string;
  model?: string;
  json?: boolean;
  srt?: boolean;
  downloadModel?: boolean;
  force?: boolean;
  out?: string;
  assets?: string;
}

function parseModel(value: string | undefined): WhisperModelName | undefined {
  if (value === undefined) return undefined;

  if (!MODELS.includes(value as WhisperModelName)) throw new Error(`--model must be one of ${MODELS.join(', ')}`);

  return value as WhisperModelName;
}

function mean(words: Transcript['words']): number | undefined {
  const scores = words.flatMap((word) => (word.confidence === undefined ? [] : [word.confidence]));

  return scores.length === 0 ? undefined : Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3));
}

/** One line per pinned section. Pure. */
export function formatPins(pins: readonly TranscriptPin[]): string[] {
  return pins.map(({ section, words, record }) => {
    const how = [[record.engine, record.model].filter(Boolean).join(' '), record.language].filter(Boolean).join(', ');
    const confidence = record.confidence === undefined ? '' : `, confidence ${record.confidence}`;

    return success(`${section}: pinned ${words} word${words === 1 ? '' : 's'} (${how}${confidence})`);
  });
}

async function transcribeMedia(flags: Flags, model: WhisperModelName | undefined): Promise<void> {
  const transcript = await transcribeMediaFile(flags.input, {
    ...(flags.language && { language: flags.language }),
    ...(model && { model }),
    ...(flags.downloadModel && { download: true }),
  });
  const srt = transcriptSrt(transcript.words);

  if (flags.srt) {
    process.stdout.write(srt);

    return;
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ...transcript, confidence: mean(transcript.words), srt }, null, 2)}\n`);

    return;
  }

  process.stdout.write(wordmark());
  console.log(
    [
      heading(flags.input),
      success(
        `${transcript.words.length} words (${transcript.engine} ${transcript.model ?? ''}, ${transcript.language ?? '?'})`
      ),
      srt,
      hint(
        'Paste the words into a section as subtitles.words, or run on a template to pin them there (--json for the words).'
      ),
    ].join('\n')
  );
}

async function transcribeTemplateFile(flags: Flags, model: WhisperModelName | undefined, rawArgs: string[]) {
  const cwd = process.cwd();
  const descriptor = JSON.parse(await fs.readFile(flags.input, 'utf8')) as { sections: [] };
  const videos = parseKeyValues(collectRepeated(rawArgs, 'video'), 'video');
  const userVideoPaths = Object.fromEntries(
    Object.entries(videos).map(([name, file]) => [name, path.resolve(cwd, file)])
  );
  const result = await transcribeTemplate(descriptor, {
    assetsDir: path.resolve(cwd, flags.assets ?? 'assets'),
    ...(Object.keys(userVideoPaths).length > 0 && { userVideoPaths }),
    ...(flags.section && { sections: flags.section.split(',').map((name) => name.trim()) }),
    ...(flags.language && { language: flags.language }),
    ...(model && { model }),
    force: Boolean(flags.force),
    now: () => new Date().toISOString(),
  });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result.descriptor, null, 2)}\n`);

    return;
  }

  const target = flags.out ?? flags.input;
  const lines = [heading(flags.input), ...formatPins(result.pins)];

  for (const warning of result.stale) lines.push(fail(`${warning.code}: ${warning.message}`), hint(warning.hint ?? ''));

  if (result.pins.length > 0) await fs.writeFile(target, `${JSON.stringify(result.descriptor, null, 2)}\n`);

  lines.push(
    result.pins.length > 0
      ? step(`wrote ${target}`)
      : step('nothing to transcribe (use --force to redo pinned sections)')
  );
  process.stdout.write(wordmark());
  console.log(lines.join('\n'));
}

export const transcribe = defineCommand({
  meta: { name: 'transcribe', description: 'Transcribe speech into word-timed captions with whisper.cpp, locally' },
  args: {
    input: {
      type: 'positional',
      description: 'A template (.json) to pin, or a media file to transcribe',
      required: true,
    },
    section: { type: 'string', description: 'Only these sections (comma-separated)' },
    language: { type: 'string', description: 'Spoken language, e.g. en, fr (default: detected)' },
    model: { type: 'string', description: 'Whisper model: tiny, base (default) or small' },
    json: {
      type: 'boolean',
      description: 'Media: print words + SRT as JSON; template: print the pinned template',
      default: false,
    },
    srt: { type: 'boolean', description: 'Media: print SRT', default: false },
    downloadModel: {
      type: 'boolean',
      description: 'Download the whisper model if missing (once, checksum-verified)',
      default: false,
    },
    force: { type: 'boolean', description: 'Re-transcribe sections that are already pinned', default: false },
    out: { type: 'string', description: 'Write the pinned template here instead of in place' },
    assets: { type: 'string', description: 'Assets dir for videoUrl clips (default ./assets)' },
    video: { type: 'string', description: 'Bind a clip: --video section=path (repeatable)' },
  },
  async run({ args, rawArgs }) {
    try {
      const flags = args as unknown as Flags;
      const model = parseModel(flags.model);
      const stats = await fs.stat(flags.input);

      if (!stats.isFile()) throw new Error(`${flags.input} is not a file`);

      if (flags.downloadModel) process.env.LECLAP_WHISPER_DOWNLOAD = '1';

      if (flags.input.toLowerCase().endsWith('.json')) {
        await transcribeTemplateFile(flags, model, rawArgs);

        return;
      }

      await transcribeMedia(flags, model);
    } catch (error) {
      console.error(fail(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  },
});
