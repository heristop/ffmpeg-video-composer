// What the agent reads: the current descriptor (redacted), its revision, and a per-section inventory
// keyed by the builder's own positions. Music lives in the editor as a section but in the descriptor as
// global fields, so every section reports its editor `position` (what add/move/remove/select take) and
// its descriptor `pointer` (what edit_template's JSON Patch paths start with; null for music).
import { templateRevision } from 'ffmpeg-video-composer/src/core/determinism/template-revision.ts';
import { videoTimeline } from 'ffmpeg-video-composer/src/core/timing/video-timeline.ts';
import { buildDescriptor, type EditorState, type TemplateDescriptor } from '@leclap/creative-kit/editor';
import {
  descriptorIndexForEditor,
  groupValidationErrors,
  runValidation,
} from '@/presentation/components/admin/editor/validationMapping';
import type { StoredPartial } from '@/stores/userPartialStore';

export interface TextSlot {
  pointer: string;
  role: string;
  value: string;
}

export interface SectionView {
  position: number;
  pointer: string | null;
  name: string | null;
  type: string;
  start?: number;
  end?: number;
  duration?: number;
  transition?: { type: string; duration: number };
  purpose?: string;
  texts: TextSlot[];
  errorCount: number;
}

// Keys whose string value (or translation map) is copy shown on screen or to the viewer.
const TEXT_KEYS = new Set(['text', 'headline', 'kicker', 'subtitle', 'title', 'label', 'description', 'cta']);
const LOCALE_KEY = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;
const MAX_TEXTS_PER_SECTION = 60;
const REDACTED = '[redacted]';

export function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** The revision agents pass back as expectedRevision: the MCP server's hash of the same JSON. */
export function revisionOf(descriptor: TemplateDescriptor): string {
  return templateRevision(descriptor as unknown as Record<string, unknown>);
}

export function currentDescriptor(state: EditorState): TemplateDescriptor {
  return buildDescriptor(state);
}

function redactValue(value: unknown, key: string, parent: Record<string, unknown> | null): unknown {
  if (typeof value === 'string') {
    if (/^(blob|data):/i.test(value)) return REDACTED;

    const sibling = parent?.url ?? parent?.src;
    const nextToUpload = typeof sibling === 'string' && sibling.startsWith('media://');

    return key === 'label' && nextToUpload ? 'user upload' : value;
  }

  if (Array.isArray(value)) return value.map((item) => redactValue(item, '', null));

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, redactValue(v, k, record)]));
  }

  return value;
}

/**
 * A copy safe to hand an agent: upload labels (often a file name) become "user upload", blob: and data:
 * URLs are dropped; `media://<key>` refs stay as opaque keys.
 */
export function redactDescriptor<T>(descriptor: T): T {
  return redactValue(descriptor, '', null) as T;
}

function collectTexts(value: unknown, pointer: string, role: string | null, out: TextSlot[]): void {
  if (out.length >= MAX_TEXTS_PER_SECTION) return;

  if (typeof value === 'string') {
    if (role && value.trim() !== '') out.push({ pointer, role, value });

    return;
  }

  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    collectTexts(child, `${pointer}/${escapePointerSegment(key)}`, childRole(key, role), out);
  }
}

// A text key starts a role; a locale key ("en", "pt-BR") under one keeps it (a translation map).
function childRole(key: string, role: string | null): string | null {
  if (TEXT_KEYS.has(key)) return key;

  return role !== null && LOCALE_KEY.test(key) ? role : null;
}

/** On-screen copy in a descriptor subtree, as JSON Pointers set_texts can target. */
export function textSlots(value: unknown, pointer: string): TextSlot[] {
  const out: TextSlot[] = [];
  collectTexts(value, pointer, null, out);

  return out;
}

type DescriptorSection = NonNullable<TemplateDescriptor['sections']>[number];

function timelineByName(descriptor: TemplateDescriptor) {
  try {
    return new Map(videoTimeline(descriptor).sections.map((section) => [section.name, section]));
  } catch {
    return new Map<string, never>();
  }
}

function sectionView(
  section: DescriptorSection,
  descriptorIndex: number,
  timing: ReturnType<typeof timelineByName>,
  errorCount: number
): Omit<SectionView, 'position'> {
  const name = typeof section.name === 'string' ? section.name : null;
  const timed = name ? timing.get(name) : undefined;
  const purpose = (section as { purpose?: unknown }).purpose;
  const pointer = `/sections/${String(descriptorIndex)}`;

  return {
    pointer,
    name,
    type: section.type,
    ...(timed ? { start: timed.start, end: timed.end, duration: timed.duration } : {}),
    ...(timed?.transition ? { transition: { type: timed.transition.type, duration: timed.transition.duration } } : {}),
    ...(typeof purpose === 'string' ? { purpose } : {}),
    texts: textSlots(section, pointer),
    errorCount,
  };
}

/** One entry per editor section, in timeline order. */
export function sectionInventory(state: EditorState, localPartials: StoredPartial[]): SectionView[] {
  const descriptor = buildDescriptor(state);
  const sections = descriptor.sections ?? [];
  const errors = groupValidationErrors(runValidation(descriptor, localPartials));
  const timing = timelineByName(descriptor);

  return descriptorIndexForEditor(state).map((descriptorIndex, position) => {
    const section = descriptorIndex === null ? undefined : sections[descriptorIndex];

    if (descriptorIndex === null || !section) {
      return { position, pointer: null, name: null, type: 'music', texts: [], errorCount: 0 };
    }

    const count = errors.byDescriptorIndex.get(descriptorIndex)?.length ?? 0;

    return { position, ...sectionView(section, descriptorIndex, timing, count) };
  });
}

/** The descriptor name of the section at editor `position` ('music' for the music section). */
export function nameAt(state: EditorState, position: number): string {
  const descriptorIndex = descriptorIndexForEditor(state)[position];

  if (descriptorIndex === null) return 'music';

  return buildDescriptor(state).sections?.[descriptorIndex]?.name ?? String(position);
}

/** Editor position of a section named `name` (its descriptor name), or null. */
export function positionOfName(state: EditorState, name: string): number | null {
  const sections = buildDescriptor(state).sections ?? [];
  const descriptorIndex = sections.findIndex((section) => section.name === name);

  if (descriptorIndex === -1) return null;

  const position = descriptorIndexForEditor(state).indexOf(descriptorIndex);

  return position === -1 ? null : position;
}
