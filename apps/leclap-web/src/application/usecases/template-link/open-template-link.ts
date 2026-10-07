// Opening a template link (`/studio/builder#t=v1.…`) in the builder: decode and validate the fragment,
// turn media only the author's machine could read into empty slots, and hand the builder a fresh,
// unsaved draft. Pure apart from the injected upload lookup; never throws — a bad link is a result.
import {
  decodeTemplatePayload,
  mediaToRebind,
  readTemplateLinkPayload,
  TemplateLinkError,
  type MediaRebindReason,
  type MediaToRebind,
  type TemplateLinkErrorCode,
} from 'ffmpeg-video-composer/src/core/template-link/index.ts';
import { toEditorState, type TemplateDescriptor } from '@leclap/creative-kit/editor';
import { importDescriptorJson } from '@/presentation/components/admin/editor/templateIO';
import { templateService, type Template } from '@/services/templateService';

const MEDIA_PREFIX = 'media://';

/** A media file the person must film, upload or pick again. `section` is null for whole-video media. */
export interface RebindItem {
  file: string;
  section: string | null;
  reason: MediaRebindReason;
}

export type TemplateLinkImport =
  | { kind: 'none' }
  | { kind: 'opened'; template: Template; rebind: RebindItem[] }
  | { kind: 'failed'; code: TemplateLinkErrorCode; details: string[] };

export interface TemplateLinkDeps {
  /** Whether this browser's media store holds the upload keyed `key` (a `media://key` ref). */
  hasUpload: (key: string) => Promise<boolean>;
}

type Json = Record<string, unknown> | unknown[];

function segmentsOf(pointer: string): string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function containerAt(root: unknown, segments: string[]): Json | null {
  let node = root;

  for (const segment of segments) {
    if (!node || typeof node !== 'object') return null;

    node = (node as Record<string, unknown>)[segment];
  }

  return node && typeof node === 'object' ? (node as Json) : null;
}

interface Removal {
  parent: Json;
  key: string;
  node: unknown;
}

// Where `segments` points, resolved to the node itself so that earlier removals cannot shift it.
function resolveAt(root: unknown, segments: string[]): Removal | null {
  const parent = containerAt(root, segments.slice(0, -1));
  const key = segments.at(-1) ?? '';

  if (!parent) return null;

  return { parent, key, node: (parent as Record<string, unknown>)[key] };
}

function remove({ parent, key, node }: Removal): void {
  if (!Array.isArray(parent)) {
    Reflect.deleteProperty(parent, key);

    return;
  }

  const index = parent.indexOf(node);

  if (index !== -1) parent.splice(index, 1);
}

function within(ancestor: string[], segments: string[]): boolean {
  return ancestor.length < segments.length && ancestor.every((segment, index) => segments[index] === segment);
}

/**
 * A copy of `descriptor` without the `refs` fields. A `url` names the whole object it sits in (an image
 * input, the music track, the watermark, a LUT), so that object goes; any other field (videoUrl,
 * pictureUrl, fontfile, …) is removed alone, which leaves its scene as an empty slot. Every target is
 * resolved before anything is removed, and a field inside an object that goes is left with it.
 */
export function stripUnreadableMedia(descriptor: unknown, refs: MediaToRebind[]): unknown {
  const copy = structuredClone(descriptor);
  const targets = refs.map((ref) => {
    const segments = segmentsOf(ref.pointer);

    return segments.at(-1) === 'url' ? segments.slice(0, -1) : segments;
  });
  const outermost = targets.filter((segments) => !targets.some((other) => within(other, segments)));
  const removals = outermost.map((segments) => resolveAt(copy, segments)).filter((entry) => entry !== null);

  for (const removal of removals) remove(removal);

  return copy;
}

async function unreadable(descriptor: unknown, deps: TemplateLinkDeps): Promise<MediaToRebind[]> {
  const refs = mediaToRebind(descriptor);
  const held = await Promise.all(
    refs.map(async (ref) =>
      ref.reason === 'device_upload' ? deps.hasUpload(ref.value.slice(MEDIA_PREFIX.length)).catch(() => false) : false
    )
  );

  return refs.filter((_ref, index) => !held[index]);
}

function rebindItem(descriptor: unknown, ref: MediaToRebind): RebindItem {
  const [root, index] = segmentsOf(ref.pointer);
  const sections = (descriptor as { sections?: Array<{ name?: unknown }> }).sections ?? [];
  const name = root === 'sections' ? sections[Number(index)]?.name : null;
  const file = ref.value.startsWith(MEDIA_PREFIX) ? ref.value.slice(MEDIA_PREFIX.length) : ref.value;

  return {
    file: file.split(/[\\/]/).findLast((part) => part !== '') ?? file,
    section: typeof name === 'string' ? name : null,
    reason: ref.reason,
  };
}

function failure(error: unknown): TemplateLinkImport {
  if (error instanceof TemplateLinkError) return { kind: 'failed', code: error.code, details: error.issues };

  return { kind: 'failed', code: 'corrupt', details: [] };
}

async function openPayload(payload: string, deps: TemplateLinkDeps): Promise<TemplateLinkImport> {
  const decoded = await decodeTemplatePayload(payload);
  const refs = await unreadable(decoded, deps);
  const descriptor = stripUnreadableMedia(decoded, refs) as TemplateDescriptor;
  const imported = importDescriptorJson(JSON.stringify(descriptor), toEditorState(null));

  if (!imported.ok) return { kind: 'failed', code: 'invalid_template', details: imported.errors };

  const { state } = imported;
  const template: Template = {
    id: state.id,
    name: state.name,
    description: state.description,
    orientation: state.orientation,
    hasForm: templateService.extractFormFields(descriptor).length > 0,
    complexity: templateService.getTemplateComplexity(descriptor),
    source: 'user',
    descriptor,
  };

  return { kind: 'opened', template, rebind: refs.map((ref) => rebindItem(decoded, ref)) };
}

/** What the location hash asks the builder to open: nothing, a new draft with media to re-bind, or why not. */
export async function importTemplateLink(hash: string, deps: TemplateLinkDeps): Promise<TemplateLinkImport> {
  const payload = readTemplateLinkPayload(hash);

  if (payload === null) return { kind: 'none' };

  try {
    return await openPayload(payload, deps);
  } catch (error) {
    return failure(error);
  }
}
