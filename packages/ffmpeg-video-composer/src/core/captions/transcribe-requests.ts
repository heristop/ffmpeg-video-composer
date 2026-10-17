// Which sections ask for a transcript (`subtitles.transcribe`) and whose clip each one listens to. Pure;
// shared by validation (invalid_transcribe_source, transcribe_unavailable), the Node resolve pass and the
// CLI / MCP surfaces, so they all agree on what "self" and a section name mean.

import type { TranscribeRequest } from '../../schemas/transcribe.schemas';

/** Section types that carry a recorded or authored clip with sound. */
export const CLIP_SECTION_TYPES: ReadonlySet<string> = new Set(['video', 'project_video']);

interface LooseSection {
  name?: unknown;
  type?: unknown;
  subtitles?: { transcribe?: TranscribeRequest } | null;
}

export interface TranscribeTarget {
  /** Index of the section whose subtitles get the words. */
  index: number;
  /** Its name. */
  name: string;
  /** The request as authored. */
  request: TranscribeRequest;
  /** The section whose clip is transcribed ("self" resolved), or null when it is not a clip section. */
  source: string | null;
  /** Index of that source section, or -1. */
  sourceIndex: number;
}

function sectionsOf(descriptor: unknown): Array<LooseSection | null | undefined> {
  const sections = (descriptor as { sections?: unknown } | null)?.sections;

  return Array.isArray(sections) ? (sections as Array<LooseSection | null | undefined>) : [];
}

function sourceIndexOf(
  sections: ReadonlyArray<LooseSection | null | undefined>,
  index: number,
  from: string | undefined
): number {
  if (from === undefined || from === 'self') return index;

  return sections.findIndex((section) => section?.name === from);
}

function transcriptionSource(
  sections: ReadonlyArray<LooseSection | null | undefined>,
  index: number,
  from: string | undefined
): { name: string | null; index: number } {
  const sourceIndex = sourceIndexOf(sections, index, from);
  const source = sourceIndex < 0 ? undefined : sections[sourceIndex];

  if (!source || !CLIP_SECTION_TYPES.has(String(source.type))) return { name: null, index: -1 };

  return { name: String(source.name), index: sourceIndex };
}

/** Every `subtitles.transcribe` request of a descriptor, with its source section resolved. */
export function transcribeTargets(descriptor: unknown): TranscribeTarget[] {
  const sections = sectionsOf(descriptor);

  return sections.flatMap((section, index) => {
    const request = section?.subtitles?.transcribe;

    if (!request || typeof request !== 'object') return [];

    const source = transcriptionSource(sections, index, request.from);

    return [
      {
        index,
        name: String(section.name),
        request,
        source: source.name,
        sourceIndex: source.index,
      },
    ];
  });
}

/** Whether a descriptor still holds an unresolved transcription request. */
export function awaitsTranscription(descriptor: unknown): boolean {
  return transcribeTargets(descriptor).length > 0;
}
