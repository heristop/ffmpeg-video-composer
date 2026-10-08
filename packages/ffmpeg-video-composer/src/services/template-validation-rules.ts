import { FONTS, findFont, isFontRef, type FontInput } from '@/core/fonts';
import { DEFAULT_TRANSITION_DURATION } from '../schemas/effects.schemas';
import type { TemplateDescriptor, Section } from '../schemas/template.schemas';
import { validateMotionSystem } from './motion-validation';
import { validateTheme } from '@/core/theme/validate';
import { validateAssertions } from './motion-assertions';
import { validateGlyphCoverage } from './glyph-coverage';
import { nearest } from './validation/suggest';
import type { ValidationError } from './validation/types';
import { validateTimeRefs } from './time-ref-validation';
import { validateLayouts } from './layout-validation';
import { validateSubtitles } from './subtitles-validation';
import { validateTranscribeSources } from './transcribe-validation';
import { validateTakeEdits } from './take-validation';
import { validateFootage } from './footage-validation';
import { validateHtmlBoxes } from './html-validation';

export type { ValidationError, ValidationFindingKind } from './validation/types';

const RENDERING_SECTION_TYPES = new Set(['video', 'project_video', 'color_background', 'image_background', 'effect']);

// Section types kenburns can zoom/pan: stills (image_background) and real footage (project_video,
// video). A solid color_background or non-rendering type (form, music) has nothing to pan.
const KENBURNS_SECTION_TYPES = new Set(['image_background', 'project_video', 'video', 'effect']);

type IndexedSection = { section: Section; index: number };

// dangling_transition: non-cut transition on the last rendering section
function danglingTransitionErrors(renderingSections: IndexedSection[]): ValidationError[] {
  const { section: lastRendering, index: lastRenderingIndex } = renderingSections.at(-1) as IndexedSection;

  if (!lastRendering.transition || lastRendering.transition.type === 'cut') {
    return [];
  }

  return [
    {
      path: `sections[${lastRenderingIndex}].transition`,
      message: `Section "${lastRendering.name}": "${lastRendering.transition.type}" transition on the last rendering section has no following section to transition into`,
      code: 'dangling_transition',
      hint: 'Remove this transition, or set its type to "cut".',
      suggestion: { type: 'cut' },
      kind: 'format',
    },
  ];
}

// Half the shorter neighbour, to two decimals: always strictly shorter than both sections, and long
// enough to still read as a transition.
function fittingTransitionDuration(smaller: number): number {
  return Math.max(0.01, Math.floor(smaller * 50) / 100);
}

// transition_too_long: effective transition duration >= smaller of the two adjacent explicit durations
function transitionPairError(
  { section: sectionA, index: indexA }: IndexedSection,
  { section: sectionB }: IndexedSection,
  template: TemplateDescriptor
): ValidationError | null {
  if (!sectionA.transition || sectionA.transition.type === 'cut') {
    return null;
  }

  const durationA = sectionA.options?.duration;
  const durationB = sectionB.options?.duration;

  // Skip when either adjacent duration is undeclared (or still in beats: the grid awaits the analysis)
  if (typeof durationA !== 'number' || typeof durationB !== 'number') {
    return null;
  }

  const effectiveDuration =
    sectionA.transition.duration ?? template.global?.transition?.duration ?? DEFAULT_TRANSITION_DURATION;
  const smaller = Math.min(durationA, durationB);

  if (effectiveDuration < smaller) {
    return null;
  }

  const fitting = fittingTransitionDuration(smaller);

  return {
    path: `sections[${indexA}].transition`,
    message: `Section "${sectionA.name}": effective transition duration ${effectiveDuration}s must be shorter than the smaller adjacent section duration ${smaller}s`,
    code: 'transition_too_long',
    hint: `Set the transition duration to ${fitting}s (or lengthen the adjacent sections).`,
    suggestion: { ...sectionA.transition, duration: fitting },
    kind: 'judgement',
  };
}

function transitionLengthErrors(renderingSections: IndexedSection[], template: TemplateDescriptor): ValidationError[] {
  return renderingSections
    .slice(0, -1)
    .map((indexed, i) => transitionPairError(indexed, renderingSections[i + 1], template))
    .filter((error): error is ValidationError => error !== null);
}

export function validateTransitions(template: TemplateDescriptor): ValidationError[] {
  const sections = template.sections;

  if (!sections || sections.length === 0) {
    return [];
  }

  const renderingSections = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => RENDERING_SECTION_TYPES.has(section.type));

  if (renderingSections.length === 0) {
    return [];
  }

  return [...danglingTransitionErrors(renderingSections), ...transitionLengthErrors(renderingSections, template)];
}

// global_animation_missing_url: a whole-video overlay (global.animations) needs a resolvable url; an
// empty one stages nothing and the final overlay pass would fail. opacity range is enforced by the schema.
export function validateGlobalAnimations(template: TemplateDescriptor): ValidationError[] {
  const animations = template.global?.animations ?? [];

  return animations
    .map((animation, index): ValidationError | null => {
      if (animation.url && animation.url.trim() !== '') {
        return null;
      }

      return {
        path: `global.animations[${index}].url`,
        message: `Whole-video animation ${index} has no url`,
        code: 'global_animation_missing_url',
        hint: 'Set url to an overlay file (.png/.jpg/.webp/.apng/.gif/.webm), or remove this animation.',
        kind: 'judgement',
      };
    })
    .filter((error): error is ValidationError => error !== null);
}

// global_watermark_missing_url: global.watermark reaches the exact same whole-video overlay pass as
// global.animations (via watermarkToAnimation), so an empty/whitespace url is the identical silent
// failure — schema `.min(1)` alone can't catch it (a whitespace-only string still satisfies min(1)),
// which is why this trims, same as validateGlobalAnimations above.
export function validateGlobalWatermark(template: TemplateDescriptor): ValidationError[] {
  const watermark = template.global?.watermark;

  if (!watermark || (watermark.url && watermark.url.trim() !== '')) {
    return [];
  }

  return [
    {
      path: 'global.watermark.url',
      message: 'Watermark has no url',
      code: 'global_watermark_missing_url',
      hint: 'Set url to a logo image (png/jpg), or remove global.watermark.',
      kind: 'judgement',
    },
  ];
}

// unknown_font: a sugar `font` string (caption / whole-video overlay) that won't resolve — neither a
// bundled font id nor a `.ttf` filename — so the renderer would silently fall back to the default.
// Surfacing it catches typos (e.g. "Oswlad"). A `{{ var }}` is resolved at runtime, so it is left alone.
//
// A font named by family (`{ family }`) is never flagged: there is no offline index of Google's
// catalog, so the family cannot be checked here — one that does not exist surfaces as a resolution
// error during the render, naming the family. This is exactly why the object form is a separate
// shape: registry ids keep their fast local typo check.
function isResolvableFont(font: string): boolean {
  return font.includes('{{') || font.endsWith('.ttf') || findFont(font) !== undefined;
}

// The authored font when it is a string that won't resolve, else null.
function unresolvableFont(font: FontInput | undefined): string | null {
  if (!font || isFontRef(font) || isResolvableFont(font)) {
    return null;
  }

  return font;
}

const KNOWN_FONTS_HINT = 'known ids: rubik, oswald, bebas, … — or a .ttf filename';

// The unknown_font finding, suggesting the nearest bundled id when the name is a likely typo.
function unknownFontError(path: string, message: string, font: string): ValidationError {
  const suggestion = nearest(
    font,
    FONTS.map((entry) => entry.id)
  );
  const finding: ValidationError = {
    path,
    message,
    code: 'unknown_font',
    hint:
      suggestion === undefined
        ? 'Use a bundled font id, a .ttf filename, or { "family": "<Google Fonts family>" }.'
        : `Use the bundled font id "${suggestion}".`,
    kind: suggestion === undefined ? 'judgement' : 'format',
  };

  return suggestion === undefined ? finding : { ...finding, suggestion };
}

export function validateFonts(template: TemplateDescriptor): ValidationError[] {
  const errors: ValidationError[] = [];
  const sections = template.sections ?? [];

  for (let index = 0; index < sections.length; index++) {
    const font = unresolvableFont(sections[index].caption?.font);

    if (font) {
      const message = `Section "${sections[index].name}": unknown caption font "${font}" (${KNOWN_FONTS_HINT})`;

      errors.push(unknownFontError(`sections[${index}].caption.font`, message, font));
    }
  }

  const overlays = template.global?.overlays ?? [];

  for (let index = 0; index < overlays.length; index++) {
    const font = unresolvableFont(overlays[index].font);

    if (font) {
      const message = `Whole-video overlay ${index}: unknown font "${font}" (${KNOWN_FONTS_HINT})`;

      errors.push(unknownFontError(`global.overlays[${index}].font`, message, font));
    }
  }

  return errors;
}

export function validateMotion(template: TemplateDescriptor): ValidationError[] {
  const errors: ValidationError[] = [];

  const sections = template.sections ?? [];

  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const hasKenburns = (section.motion ?? []).some((effect) => effect.type === 'kenburns');

    if (!hasKenburns) {
      continue;
    }

    if (KENBURNS_SECTION_TYPES.has(section.type)) {
      continue;
    }

    errors.push({
      path: `sections[${index}].motion`,
      message: `Section "${section.name}": kenburns motion requires a video or image_background section`,
      code: 'motion_unsupported_section',
      hint: 'Remove the kenburns entry from motion, or make this a video, project_video or image_background section.',
      suggestion: (section.motion ?? []).filter((effect) => effect.type !== 'kenburns'),
      kind: 'judgement',
    });
  }

  return errors;
}

/** Every descriptor-level rule beyond the zod schema, in reporting order. */
export function validateDescriptorRules(template: TemplateDescriptor): ValidationError[] {
  return [
    ...validateTransitions(template),
    ...validateMotion(template),
    ...validateGlobalAnimations(template),
    ...validateGlobalWatermark(template),
    ...validateFonts(template),
    ...validateMotionSystem(template),
    ...validateTheme(template),
    ...validateAssertions(template),
    ...validateGlyphCoverage(template),
    ...validateTimeRefs(template),
    ...validateLayouts(template),
    ...validateSubtitles(template),
    ...validateTranscribeSources(template),
    ...validateTakeEdits(template),
    ...validateFootage(template),
    ...validateHtmlBoxes(template),
  ];
}
