// Pinning a transcript: the section's `subtitles.transcribe` request is replaced by `subtitles.words`,
// and `meta.resolved.transcripts[section]` records the engine, model, language, clip digest and date, so a
// render only ever reads pinned words and `transcript_stale` can tell when the clip changed. The record's
// `edit` fingerprints the section edits the words were mapped through, so `transcript_edit_changed` can
// tell when the section was re-cut since. Pure.

import type { TranscriptRecord } from '../../schemas/transcribe.schemas';
import type { MotionWarning } from '../../services/motion-lint';
import type { TranscriptWord } from './transcript-time';
import { editFingerprint } from './edit-fingerprint';

export { editFingerprint } from './edit-fingerprint';

type LooseDescriptor = { meta?: unknown; sections?: unknown };
type LooseSection = { name?: unknown; options?: unknown; subtitles?: Record<string, unknown> };

/** The descriptor with section `index` pinned to `words` (input untouched). */
export function pinTranscript<T extends LooseDescriptor>(
  descriptor: T,
  index: number,
  words: readonly TranscriptWord[],
  record: TranscriptRecord,
  subtitles: Record<string, unknown> = {}
): T {
  const sections = [...((descriptor.sections as LooseSection[] | undefined) ?? [])];
  const section = sections[index];
  const { transcribe: _request, ...kept } = section.subtitles ?? {};

  sections[index] = { ...section, subtitles: { ...kept, ...subtitles, words: [...words] } };

  const meta = (descriptor.meta ?? {}) as { resolved?: { transcripts?: Record<string, TranscriptRecord> } };
  const transcripts = { ...meta.resolved?.transcripts, [String(section.name)]: record };

  return { ...descriptor, meta: { ...meta, resolved: { ...meta.resolved, transcripts } }, sections };
}

/** The pinned transcript records of a descriptor, by section name. */
export function transcriptRecords(descriptor: unknown): Record<string, TranscriptRecord> {
  const meta = (descriptor as { meta?: { resolved?: { transcripts?: unknown } } } | null)?.meta;
  const transcripts = meta?.resolved?.transcripts;

  return transcripts && typeof transcripts === 'object' ? (transcripts as Record<string, TranscriptRecord>) : {};
}

function sectionOptions(descriptor: unknown, name: string): { found: boolean; options: unknown } {
  const sections = (descriptor as { sections?: unknown } | null)?.sections;
  const section = Array.isArray(sections)
    ? (sections as LooseSection[]).find((candidate) => candidate.name === name)
    : undefined;

  return { found: section !== undefined, options: section?.options };
}

function staleClip(section: string, record: TranscriptRecord, now: string | undefined): MotionWarning[] {
  if (!record.digest || now === undefined || now === record.digest) return [];

  return [
    {
      path: `meta.resolved.transcripts.${section}`,
      code: 'transcript_stale',
      severity: 'warn',
      message: `Section "${section}": its captions were transcribed from a different "${record.from}" clip`,
      hint: "Re-transcribe (`leclap transcribe <template> --force` or the app's Captions toggle) so the words match the new take.",
    },
  ];
}

function changedEdit(descriptor: unknown, section: string, record: TranscriptRecord): MotionWarning[] {
  const source = sectionOptions(descriptor, record.from);

  if (!record.edit || !source.found || editFingerprint(source.options) === record.edit) return [];

  return [
    {
      path: `meta.resolved.transcripts.${section}`,
      code: 'transcript_edit_changed',
      severity: 'warn',
      message: `Section "${section}": "${record.from}" was re-cut (clip, speed, ramp, freeze, trim or duration) since its captions were pinned`,
      hint: 'Re-transcribe (`leclap transcribe <template> --force`) so the words follow the new edit.',
    },
  ];
}

/**
 * transcript_stale: a pinned transcript whose source clip no longer has the digest it was transcribed
 * from. `current` maps the source section name to the clip's digest now (sections not measured are skipped).
 * transcript_edit_changed: the source section's edits no longer match the pin's fingerprint (pins
 * written before the fingerprint existed are not checked).
 */
export function staleTranscripts(descriptor: unknown, current: Partial<Record<string, string>>): MotionWarning[] {
  return Object.entries(transcriptRecords(descriptor)).flatMap(([section, record]) => [
    ...staleClip(section, record, current[record.from]),
    ...changedEdit(descriptor, section, record),
  ]);
}
