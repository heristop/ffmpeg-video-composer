import type { Filter, Section } from '@/core/types';
import type { Camera } from '../../schemas/camera.schemas';
import { cameraFilters } from '@/core/motion/camera';
import type { SugarContext } from './sugar-context';

// Where a section's camera runs. By default it moves the finished frame (text and graphics included), so
// it is appended at the very end of the chain by SegmentBuilder; `includeText: false` keeps overlays
// steady, so it lowers as background sugar beneath them instead. When the section's authored chain frames
// the picture before its first text (scale / pad / perspective ahead of a drawtext), that framing is part
// of the shot: the camera then runs inside the authored chain, right ahead of that first text.

function sectionCamera(section: Section, ctx: SugarContext): string[] {
  const camera = (section as { camera?: Camera }).camera;

  if (!camera || !ctx.motion) return [];

  const [width, height] = ctx.scale.split(':').map(Number);

  return cameraFilters(camera, {
    width,
    height,
    fps: ctx.fps,
    duration: ctx.duration,
    seed: ctx.motion.seedFor('camera'),
  });
}

/** Camera filters for the end of the chain (includeText, the default). */
export function cameraEndOfChain(section: Section, ctx: SugarContext): string[] {
  return (section as { camera?: Camera }).camera?.includeText === false ? [] : sectionCamera(section, ctx);
}

function filterObjects(filters: string[]): Filter[] {
  return filters.map((filter) => {
    const split = filter.indexOf('=');

    return { type: filter.slice(0, split), value: filter.slice(split + 1) };
  });
}

// Where an includeText:false camera enters the authored chain: ahead of its first drawtext when framing
// filters precede it, else 0 (the camera stays background sugar, under the whole authored chain).
function framingEnd(section: Section): number {
  if ((section as { camera?: Camera }).camera?.includeText !== false) return 0;

  return Math.max(
    0,
    (section.filters ?? []).findIndex((filter) => filter.type === 'drawtext')
  );
}

/** Camera filters as background sugar (includeText: false, no authored framing ahead of the text). */
export function cameraBackground(section: Section, ctx: SugarContext): Filter[] {
  if ((section as { camera?: Camera }).camera?.includeText !== false || framingEnd(section) > 0) return [];

  return filterObjects(sectionCamera(section, ctx));
}

/**
 * The authored chain with an includeText:false camera spliced after its framing filters, and the index
 * where the section's text starts in it (where overlay-class sugar text is spliced, so it stays steady
 * too). Unchanged, with `textAt` 0, when the camera is not framed (see cameraBackground).
 */
export function framedCamera(section: Section, ctx: SugarContext): { chain: Filter[]; textAt: number } {
  const chain = section.filters ?? [];
  const end = framingEnd(section);

  if (end === 0) return { chain, textAt: 0 };

  const camera = filterObjects(sectionCamera(section, ctx));

  return { chain: [...chain.slice(0, end), ...camera, ...chain.slice(end)], textAt: end + camera.length };
}
