// What a section layout pane (schemas/layout.schemas.ts) draws, from its authored reference. Pure:
// shared by the lowering (editor/presets/layout.ts) and validation (services/layout-validation.ts).
//
// A reference names, in order of precedence:
// - this section itself → its own base stream (background colour / picture / clip);
// - another section → the media that section shows: a color_background's colour, an image_background's
//   pictureUrl, a video's videoUrl, or a recorded clip (project_video, or a video reusing one through
//   useVideoSection) — the same conventions the sections themselves use;
// - a #RRGGBB[@alpha] colour;
// - a media URL or path: still images by extension (png/jpg/webp/bmp), everything else as video.

export type LayoutSource =
  | { kind: 'self' }
  | { kind: 'color'; color: string }
  | { kind: 'media'; url: string; still: boolean }
  | { kind: 'clip'; section: string };

/** The fields of a section a layout reference can resolve against. */
export interface LayoutSectionRef {
  name?: string;
  type: string;
  options?: {
    backgroundColor?: string;
    pictureUrl?: string;
    videoUrl?: string;
    useVideoSection?: string;
  };
}

const STILL = /\.(png|jpe?g|webp|bmp)(\?.*)?$/i;
const COLOR = /^#[0-9a-f]{3,8}(@[0-9.]+)?$/i;

function sectionSource(section: LayoutSectionRef): LayoutSource | null {
  const options = section.options ?? {};

  if (section.type === 'color_background') return { kind: 'color', color: options.backgroundColor ?? '#000000' };

  if (options.pictureUrl) return { kind: 'media', url: options.pictureUrl, still: true };

  if (options.videoUrl) return { kind: 'media', url: options.videoUrl, still: false };

  if (options.useVideoSection) return { kind: 'clip', section: options.useVideoSection };

  return section.type === 'project_video' && section.name ? { kind: 'clip', section: section.name } : null;
}

/** The pane source a reference names, or null when it names nothing drawable. */
export function classifyLayoutSource(
  ref: string,
  sections: readonly LayoutSectionRef[],
  self: string
): LayoutSource | null {
  if (ref === self) return { kind: 'self' };

  const section = sections.find((candidate) => candidate.name === ref);

  if (section) return sectionSource(section);

  if (COLOR.test(ref)) return { kind: 'color', color: ref };

  return /[./]/.test(ref) ? { kind: 'media', url: ref, still: STILL.test(ref) } : null;
}
