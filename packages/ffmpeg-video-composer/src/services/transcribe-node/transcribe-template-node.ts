// Pinning a template's transcripts outside a render (`leclap transcribe <template>`, MCP): find each
// requesting section's clip on disk (a bound recording, a local videoUrl, the assets-dir fallback),
// measure what its edits need (probed length for a preset ramp, silences for trimSilence), transcribe
// and pin. `force` turns already-pinned sections back into requests first; `stale` lists pins whose clip
// changed since (transcript_stale).

import fs from 'node:fs';
import path from 'node:path';
import type { TranscribeRequest, TranscriptRecord } from '../../schemas/transcribe.schemas';
import { sectionTranscriptEdit, type TranscriptEdit } from '@/core/captions/transcript-time';
import { sourceLengthKey } from '@/core/footage/source-length';
import { staleTranscripts, transcriptRecords } from '@/core/captions/transcript-pin';
import { computeKeepRanges, resolveTrimSilence } from '@/core/footage/keep-ranges';
import type { MotionWarning } from '../motion-lint';
import { resolveTranscripts, type TranscriptPin } from '../../director/transcription';
import type { TranscriptionService } from '../../director/transcribe-sections';
import { createFootageAnalyzer } from '../footage-analysis-node';
import { runProcess } from './whisper-run';
import { nodeTranscriptionService } from './transcribe-media-node';
import type { WhisperModelName } from './whisper-models';

export interface LooseSection {
  name: string;
  type?: string;
  options?: Record<string, unknown>;
  subtitles?: Record<string, unknown>;
}

export interface ClipLookup {
  assetsDir?: string;
  userVideoPaths?: Record<string, string>;
  exists?: (file: string) => boolean;
}

function isFile(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function assetPath(url: string, assetsDir: string | undefined): string {
  if (/^https?:\/\//.test(url)) {
    throw new Error(
      `remote videoUrl ${url}: download it and point videoUrl at the local file, or bind the clip with --video`
    );
  }

  if (path.isAbsolute(url) && !url.includes('/assets/')) return url;

  const marker = url.lastIndexOf('/assets/');

  return path.join(assetsDir ?? '', marker === -1 ? url : url.slice(marker + '/assets/'.length));
}

/** The local clip of a section, or null when none exists on disk. */
export function clipOfSection(section: LooseSection, lookup: ClipLookup): string | null {
  const exists = lookup.exists ?? isFile;

  function bound(name: string): string {
    return lookup.userVideoPaths?.[name] ?? path.join(lookup.assetsDir ?? '', 'videos', `${name}.mp4`);
  }

  const options = section.options ?? {};
  let candidate = bound(section.name);

  if (typeof options.useVideoSection === 'string') candidate = bound(options.useVideoSection);

  if (typeof options.videoUrl === 'string' && !lookup.userVideoPaths?.[section.name]) {
    candidate = assetPath(options.videoUrl, lookup.assetsDir);
  }

  return exists(candidate) ? candidate : null;
}

export interface TranscribeTemplateOptions extends ClipLookup {
  language?: string;
  model?: WhisperModelName;
  /** Only these sections. */
  sections?: readonly string[];
  /** Re-transcribe sections that are already pinned. */
  force?: boolean;
  ffmpeg?: string;
  ffprobe?: string;
  fps?: number;
  service?: TranscriptionService;
  signal?: AbortSignal;
  /** Stamps the pin record's `at` (ISO 8601). Omitted on the render path, which never reads the clock. */
  now?: () => string;
}

type Descriptor = { meta?: unknown; sections: LooseSection[]; global?: { fps?: number } };

function requestFrom(name: string, record: TranscriptRecord | undefined): TranscribeRequest {
  return {
    ...(record && record.from !== name ? { from: record.from } : {}),
    ...(record?.language ? { language: record.language } : {}),
    ...(record?.model && ['tiny', 'base', 'small'].includes(record.model)
      ? { model: record.model as WhisperModelName }
      : {}),
  };
}

// Requests with the CLI overrides; with `force`, pinned sections become requests again.
function withRequests(descriptor: Descriptor, options: TranscribeTemplateOptions): Descriptor {
  const records = transcriptRecords(descriptor);

  function selected(name: string): boolean {
    return !options.sections || options.sections.includes(name);
  }

  const overrides = {
    ...(options.language ? { language: options.language } : {}),
    ...(options.model ? { model: options.model } : {}),
  };
  const sections = descriptor.sections.map((section) => {
    const subtitles = section.subtitles;
    const repin = options.force && subtitles?.words !== undefined && Object.hasOwn(records, section.name);

    if (!subtitles || !selected(section.name) || !(subtitles.transcribe || repin)) return section;

    const { words: _words, transcribe, ...rest } = subtitles;
    const request = (transcribe as TranscribeRequest | undefined) ?? requestFrom(section.name, records[section.name]);

    return { ...section, subtitles: { ...rest, transcribe: { ...request, ...overrides } } };
  });

  return { ...descriptor, sections };
}

async function probedLength(file: string, ffprobe: string): Promise<number | undefined> {
  const { stdout } = await runProcess(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    file,
  ]);
  const seconds = Number(stdout.trim());

  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

// The kept windows of a trimSilence take, analysed on the section's own clip.
async function keptWindows(
  file: string | null,
  trimSilence: unknown,
  options: TranscribeTemplateOptions
): Promise<Array<[number, number]> | undefined> {
  if (!file || !trimSilence) return undefined;

  const sourceLength = await probedLength(file, options.ffprobe ?? 'ffprobe');

  if (!sourceLength) return undefined;

  const params = resolveTrimSilence(trimSilence);
  const silences = await createFootageAnalyzer(options.ffmpeg ?? 'ffmpeg').silences(file, params);

  return computeKeepRanges(silences, sourceLength, params);
}

// The section's edit as the render pass builds it: the probed length only where the lowering scales by
// one (sourceLengthKey) and the edit reads it (a preset ramp), the kept windows of a trimSilence take.
async function editOf(
  section: LooseSection,
  clipOf: (name: string) => string | null,
  options: TranscribeTemplateOptions,
  fps: number
): Promise<TranscriptEdit> {
  const opts = section.options ?? {};
  const key = sourceLengthKey(section);
  const keyFile = key === null || typeof opts.speedRamp !== 'string' ? null : clipOf(key);
  const length = keyFile === null ? undefined : await probedLength(keyFile, options.ffprobe ?? 'ffprobe');
  const lengths = key !== null && length !== undefined ? { [key]: length } : {};
  const keep = await keptWindows(clipOf(section.name), opts.trimSilence, options);

  return sectionTranscriptEdit(section, { fps, lengths, keep });
}

export interface TranscribeTemplateResult<T> {
  descriptor: T;
  pins: TranscriptPin[];
  stale: MotionWarning[];
}

async function staleOf(descriptor: Descriptor, service: TranscriptionService, clipOf: (name: string) => string | null) {
  const sources = [...new Set(Object.values(transcriptRecords(descriptor)).map((record) => record.from))];
  const digests = await Promise.all(
    sources.map(async (source) => {
      const file = clipOf(source);

      return file ? [[source, await service.digest(file)] as const] : [];
    })
  );

  return staleTranscripts(descriptor, Object.fromEntries(digests.flat()));
}

/** The template with its transcription requests pinned (Node, whisper.cpp unless a service is passed). */
export async function transcribeTemplate<T extends Descriptor>(
  descriptor: T,
  options: TranscribeTemplateOptions = {}
): Promise<TranscribeTemplateResult<T>> {
  const service = options.service ?? nodeTranscriptionService(() => options.ffmpeg);
  const fps = options.fps ?? descriptor.global?.fps ?? 30;

  function clipOf(name: string): string | null {
    const section = descriptor.sections.find((candidate) => candidate.name === name);

    return section ? clipOfSection(section, options) : null;
  }

  const { descriptor: pinned, pins } = await resolveTranscripts(withRequests(descriptor, options), {
    transcribe: service.transcribe,
    digestOf: service.digest,
    sourceOf: async (name) => clipOf(name),
    editOf: (section) => editOf(section as LooseSection, clipOf, options, fps),
    sections: options.sections,
    signal: options.signal,
    now: options.now,
  });

  return { descriptor: pinned as T, pins, stale: await staleOf(pinned, service, clipOf) };
}
