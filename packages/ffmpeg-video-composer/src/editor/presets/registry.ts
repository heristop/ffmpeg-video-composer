import type { Filter, Section, TemplateDescriptorGlobal } from '@/core/types';
import { layersToFilters, motionToFilters, gradeToFilters, lookToFilters, letterboxToFilters } from './looks';
import { globalTextOverlayToFilters } from './text-blocks';
import { sectionLayoutFilters } from './layout';
import { cameraBackground } from './camera';
import { OVERLAY_SUGAR_COMPILERS, type SugarCompiler, type SugarLayer } from './overlay-sugars';

export type { SugarContext, KineticSugarContext } from './sugar-context';
export type { SugarCompiler, SugarLayer } from './overlay-sugars';
export { compositingContext, createExtraInputs } from './compositing';
// Emoji leave the lowered text right after the sugar compiles (editor/emoji); re-exported so the builder
// stages both from one place.
export { createEmojiPlan, type EmojiPlan } from '../emoji/EmojiPlan';
import type { SugarContext } from './sugar-context';

// The background sugars bake into the video before overlays. The overlay sugars (caption onward) live in
// overlay-sugars.ts so validation can lower them without loading these.
const BACKGROUND_SUGAR_COMPILERS: SugarCompiler[] = [
  {
    // Split screen / before-after: composes the frame first, so everything below grades the whole.
    key: 'layout',
    order: 5,
    layer: 'background',
    compile: (section, ctx) => sectionLayoutFilters(section, ctx),
  },
  {
    key: 'layers',
    order: 10,
    layer: 'background',
    compile: (section) => layersToFilters(section.options?.layers),
  },
  {
    key: 'motion',
    order: 20,
    layer: 'background',
    compile: (section, ctx) => motionToFilters(section.motion, ctx),
  },
  {
    key: 'camera',
    order: 25,
    layer: 'background',
    compile: (section, ctx) => cameraBackground(section, ctx),
  },
  {
    key: 'grade',
    order: 30,
    layer: 'background',
    compile: (section) => gradeToFilters(section.grade),
  },
  {
    key: 'look',
    order: 40,
    layer: 'background',
    compile: (section) => lookToFilters(section.look),
  },
  {
    key: 'letterbox',
    order: 45,
    layer: 'background',
    compile: (section, ctx) => letterboxToFilters(section.letterbox, ctx),
  },
];

// Order preserves the previous hardcoded chain: layers → motion → grade → look → letterbox → caption.
export const SUGAR_COMPILERS: SugarCompiler[] = [...BACKGROUND_SUGAR_COMPILERS, ...OVERLAY_SUGAR_COMPILERS];

/**
 * Lowers the section's structured-sugar fields into raw filters, split by layer and sorted by each
 * compiler's `order`. `background` filters bake into the video before overlays; `overlay` filters
 * (text) draw on top — the caller routes them onto the final map when an overlay graph exists; `top`
 * filters draw last, after the section's authored chain (its masks and filters) too.
 */
export function compileSugarLayers(
  section: Section,
  ctx: SugarContext
): { background: Filter[]; overlay: Filter[]; top: Filter[] } {
  const sorted = [...SUGAR_COMPILERS].sort((a, b) => a.order - b.order);

  function select(layer: SugarLayer): Filter[] {
    return sorted.filter((compiler) => compiler.layer === layer).flatMap((compiler) => compiler.compile(section, ctx));
  }

  return { background: select('background'), overlay: select('overlay'), top: select('top') };
}

/**
 * Lowers the GLOBAL decoration set (the whole-video siblings of the section sugar) for one section,
 * split by layer. `look`/`grade` apply across every section as background colour; text `overlays`
 * draw on top of every section (or a named subset) — the engine fans the once-authored decoration
 * out to each section, reusing the section's own draw-order routing and text formatting.
 *
 * `look` and `grade` are per-field WHOLESALE overrides: a section that defines its own `look` (or
 * `grade`) is compiled by compileSugarLayers, so the global `look` (or `grade`) is suppressed here to
 * avoid double-grading. The override is independent per field — a section can override `grade` while
 * still inheriting the global `look`, and vice-versa.
 */
export function compileGlobalDecorations(
  global: TemplateDescriptorGlobal | undefined,
  section: Section,
  ctx: SugarContext
): { background: Filter[]; overlay: Filter[] } {
  if (!global) {
    return { background: [], overlay: [] };
  }

  const look = section.look === undefined ? lookToFilters(global.look) : [];
  const grade = section.grade === undefined ? gradeToFilters(global.grade) : [];
  const background = [...look, ...grade];

  const overlay = (global.overlays ?? [])
    .filter((overlay) => overlay.sections === undefined || overlay.sections.includes(section.name))
    .flatMap((overlay) => globalTextOverlayToFilters(overlay, { scale: ctx.scale }));

  return { background, overlay };
}
