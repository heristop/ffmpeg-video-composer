// One template, several formats. A template declares its other formats in `formats` (the engine's
// core/formats); the apps pick one per render instead of listing a variant per orientation. The pick
// resolves here, once, into a plain descriptor in that format, so the recorder, the preview and the
// compile all read the same frame.
import { baseFormat, declaredFormats, resolveFormat } from 'ffmpeg-video-composer/src/core/formats/resolve.ts';
import { expandPartialsWithRegistry } from './partials';
import type { TemplateDescriptor, TemplateOrientation } from './types';

/** Where a retired template id or name now points: the merged template, in the format it used to render. */
export interface TemplateRef {
  id: string;
  format?: TemplateOrientation;
}

// Templates merged into another one's formats. Saved projects and links keep their old id (web) or
// name (Expo), so both resolve to the merged template in the format the retired variant rendered.
const RETIRED_TEMPLATES: Array<{ id: string; name: string; to: Required<TemplateRef> }> = [
  {
    id: 'present-yourself-portrait',
    name: 'Present Yourself (Portrait)',
    to: { id: 'present-yourself', format: 'portrait' },
  },
];

/** The template a stored id or name refers to, with the format a retired variant implies. */
export function resolveTemplateRef(ref: string): TemplateRef {
  const retired = RETIRED_TEMPLATES.find((entry) => entry.id === ref || entry.name === ref);

  return retired ? { ...retired.to } : { id: ref };
}

/** Every format the descriptor renders (landscape, portrait, square order): its own and each one it composes. */
export function formatsOf(descriptor: TemplateDescriptor): TemplateOrientation[] {
  return declaredFormats(descriptor);
}

/**
 * The descriptor composed for `format`: partials expanded (a format may patch a partial's sections),
 * `formats[format]` applied and dropped, `global.orientation` set. Untouched for its own orientation or
 * a format it does not declare.
 */
export function descriptorInFormat(descriptor: TemplateDescriptor, format: TemplateOrientation): TemplateDescriptor {
  if (format === baseFormat(descriptor) || !formatsOf(descriptor).includes(format)) return descriptor;

  return resolveFormat(expandPartialsWithRegistry(descriptor), format).descriptor;
}
