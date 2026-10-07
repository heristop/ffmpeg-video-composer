// Advisory findings about a multi-format descriptor as a whole (they ride the motion-warning channel):
//   - format_crop_only: a declared format with no override at all renders the base composition re-framed,
//     which is a crop, not a composition for that aspect;
//   - format_story_diverges: a format whose sections are not the base story's, in order, minus the ones
//     its override removes explicitly (one story, several formats).

import { FORMAT_MARKER, isPlainObject, markerFormats, type FormatName } from './marker';
import { removes } from './merge';
import { baseFormat, declaredFormats, resolveFormat, usesFormats } from './resolve';

export interface FormatAdvisory {
  path: string;
  code: string;
  message: string;
  severity: 'warn';
  hint?: string;
}

const ASPECT: Record<FormatName, number> = { landscape: 16 / 9, portrait: 9 / 16, square: 1 };

type Loose = Record<string, unknown>;

function overrideOf(template: Loose, format: FormatName): Loose {
  const formats = isPlainObject(template.formats) ? template.formats : {};
  const override = formats[format];

  return isPlainObject(override) ? override : {};
}

function hasEntries(value: unknown): boolean {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function hasOverride(template: Loose, format: FormatName): boolean {
  const override = overrideOf(template, format);

  return hasEntries(override.global) || hasEntries(override.sections) || markerFormats(template).has(format);
}

function cropOnly(format: FormatName, base: FormatName): FormatAdvisory {
  return {
    path: `formats.${format}`,
    code: 'format_crop_only',
    severity: 'warn',
    message: `The ${format} format has no overrides: it renders the ${base} composition re-framed, which is a crop, not a ${format} composition.`,
    hint:
      `Recompose it: at least its own type size ({ "${FORMAT_MARKER}": { … } } on kinetic size) and holds ` +
      '(options.duration), and fewer simultaneous elements (sections.<name>.kinetic.byId.<id>.remove).',
  };
}

function sectionNames(sections: unknown): (string | undefined)[] {
  return (Array.isArray(sections) ? sections : []).map((section) =>
    isPlainObject(section) && typeof section.name === 'string' ? section.name : undefined
  );
}

function storyDivergence(template: Loose, format: FormatName): FormatAdvisory | undefined {
  const { descriptor, issues } = resolveFormat(template, format);

  if (issues.length > 0) return undefined;

  const patches = overrideOf(template, format).sections;
  const removed = new Set(
    Object.keys(isPlainObject(patches) ? patches : {}).filter((name) => removes((patches as Loose)[name]))
  );
  const expected = sectionNames(template.sections).filter((name) => name === undefined || !removed.has(name));
  const actual = sectionNames(descriptor.sections);

  if (JSON.stringify(actual) === JSON.stringify(expected)) return undefined;

  return {
    path: `formats.${format}`,
    code: 'format_story_diverges',
    severity: 'warn',
    message: `The ${format} format tells a different story: sections [${actual.join(', ')}] instead of [${expected.join(', ')}].`,
    hint: 'Keep section names and order in every format; drop a section with sections.<name>.remove instead of renaming or reordering it.',
  };
}

/** Whole-descriptor advisories of a partial-expanded descriptor that uses formats; [] otherwise. */
export function formatAdvisories(template: unknown): FormatAdvisory[] {
  if (!isPlainObject(template) || !usesFormats(template)) return [];

  const base = baseFormat(template);
  const declared = declaredFormats(template);
  const crops = declared
    .filter((format) => format !== base && ASPECT[format] !== ASPECT[base] && !hasOverride(template, format))
    .map((format) => cropOnly(format, base));
  const stories = declared.map((format) => storyDivergence(template, format));

  return [...crops, ...stories.filter((advisory): advisory is FormatAdvisory => advisory !== undefined)];
}
