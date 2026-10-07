import type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { MediaChoice } from '@/presentation/components/admin/templateEditorModel';
import { findMusic, findBackground } from '@/data/mediaCatalog';
import { applyLibraryBeats } from './musicBeats';

export interface MediaChoices {
  music?: MediaChoice | null;
  background?: MediaChoice | null;
}

function resolveMusic(choice: MediaChoice): { name: string; url?: string } {
  if (choice.source === 'library') {
    const entry = findMusic(choice.id);

    return { name: choice.id, url: entry?.url };
  }

  if (choice.source === 'url') {
    // A pasted remote URL is fetched as-is by the engine; name is a readable label (the file part).
    const file = choice.url.split('/').filter(Boolean).at(-1);

    return { name: file ?? choice.url, url: choice.url };
  }

  return { name: choice.key, url: `media://${choice.key}` };
}

function resolveBg(choice: MediaChoice): string {
  if (choice.source === 'library') {
    return findBackground(choice.id)?.url ?? '';
  }

  if (choice.source === 'url') {
    return choice.url;
  }

  return `media://${choice.key}`;
}

function applyMusicChoice(descriptor: TemplateDescriptor, choice: MediaChoice): void {
  descriptor.global ??= {};
  descriptor.global.music = resolveMusic(choice);
  descriptor.global.musicEnabled = true;

  // A library track carries its measured beat grid and drop (uploads are analyzed later, in the browser).
  if (choice.source === 'library') applyLibraryBeats(descriptor, choice.id);
}

function applyBackgroundChoice(descriptor: TemplateDescriptor, choice: MediaChoice): void {
  const url = resolveBg(choice);

  for (const section of descriptor.sections ?? []) {
    if (section.type === 'image_background') {
      section.options = { ...section.options, pictureUrl: url };
    }
  }
}

// global.watermark.url carries the same marker vocabulary as a section input (see WatermarkChoice.image
// in the kit model) — resolve a library:// pick the same way findBackground resolves a section input.
function resolveWatermarkMarker(descriptor: TemplateDescriptor): void {
  const watermarkUrl = descriptor.global?.watermark?.url;

  if (watermarkUrl?.startsWith('library://') && descriptor.global?.watermark) {
    descriptor.global.watermark.url = findBackground(watermarkUrl.slice('library://'.length))?.url ?? watermarkUrl;
  }
}

// Author-set image-overlay inputs (a video section's background/logo) carry a `library://<id>`
// marker; resolve it to the curated `/backgrounds/<file>` url. `media://` uploads are left for
// materializeTemplateMedia; pasted urls pass through untouched. Exported so the builder's preview
// render resolves the same markers (the engine can't fetch a raw `library://` url → segment aborts).
export function resolveLibraryInputMarkers(descriptor: TemplateDescriptor): void {
  for (const section of descriptor.sections ?? []) {
    for (const input of section.inputs ?? []) {
      if (input.url?.startsWith('library://')) {
        input.url = findBackground(input.url.slice('library://'.length))?.url ?? input.url;
      }
    }
  }

  resolveWatermarkMarker(descriptor);
}

/**
 * Injects user-chosen music and background into a template descriptor in place,
 * BEFORE materializeTemplateMedia runs. Curated library URLs land as-is;
 * uploaded blob references land as `media://<key>` which materializeTemplateMedia
 * then copies into the engine filesystem.
 */
export function applyMediaChoices(descriptor: TemplateDescriptor, choices: MediaChoices): void {
  if (choices.music) {
    applyMusicChoice(descriptor, choices.music);
  }

  if (choices.background) {
    applyBackgroundChoice(descriptor, choices.background);
  }

  resolveLibraryInputMarkers(descriptor);
}
