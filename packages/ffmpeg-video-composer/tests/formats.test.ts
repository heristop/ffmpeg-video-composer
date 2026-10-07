import { describe, expect, it } from 'vitest';
import {
  baseFormat,
  declaredFormats,
  mergePatch,
  resolveBuildFormat,
  resolveFormat,
  resolveMarkers,
  usesFormats,
} from '@/core/formats';
import { formatAdvisories } from '@/core/formats/advisories';
import { mergeFormatFindings } from '@/core/formats/findings';
import { TemplateValidator } from '@/services/TemplateValidator';
import { motionCatalog } from '@/core/motion/catalog';
import type { ValidationError } from '@/services/validation/types';

type Loose = Record<string, any>;

function section(name: string, extra: Loose = {}): Loose {
  return { name, type: 'color_background', options: { backgroundColor: '#101010', duration: 2 }, ...extra };
}

const kinetic = [
  { id: 'title', text: { en: 'Hello' }, preset: 'cascade', size: 100 },
  { id: 'aside', text: { en: 'small print' }, preset: 'fade', size: 30 },
  { text: { en: 'no id' }, preset: 'fade' },
];

function story(formats?: Loose): Loose {
  return {
    global: { orientation: 'landscape', musicEnabled: false },
    sections: [section('hook', { kinetic: structuredClone(kinetic) }), section('middle'), section('end')],
    ...(formats ? { formats } : {}),
  };
}

describe('mergePatch', () => {
  const ctx = (): { issues: ValidationError[] } => ({ issues: [] });

  it('merges objects key by key, replaces arrays and scalars, deletes on null', () => {
    const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2, 3], gone: true };
    const merged = mergePatch(base, { a: 2, nested: { y: 3, z: 4 }, list: [9], gone: null }, '', ctx());

    expect(merged).toEqual({ a: 2, nested: { x: 1, y: 3, z: 4 }, list: [9] });
    expect(base).toEqual({ a: 1, nested: { x: 1, y: 2 }, list: [1, 2, 3], gone: true });
  });

  it('patches array elements by id and removes them', () => {
    const merged = mergePatch(
      kinetic,
      { byId: { title: { size: 140, accent: { words: 'last' } }, aside: { remove: true } } },
      'kinetic',
      ctx()
    );

    expect(merged).toEqual([
      { id: 'title', text: { en: 'Hello' }, preset: 'cascade', size: 140, accent: { words: 'last' } },
      { text: { en: 'no id' }, preset: 'fade' },
    ]);
  });

  it('reports an unknown id (with a suggestion) and byId over a non-array', () => {
    const context = ctx();

    mergePatch(kinetic, { byId: { titel: { size: 1 } } }, 'kinetic', context);
    mergePatch({ a: 1 }, { byId: { x: {} } }, 'camera', context);

    expect(context.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['format_unknown_id', 'kinetic.byId.titel'],
      ['format_byid_not_array', 'camera.byId'],
    ]);
    expect(context.issues[0].suggestion).toBe('title');
  });

  it('lets a $format marker replace the base value', () => {
    expect(mergePatch({ x: 1 }, { $format: { default: 2 } }, '', ctx())).toEqual({ $format: { default: 2 } });
  });
});

describe('$format markers', () => {
  it('resolves per format, falls back to default, and resolves nested markers', () => {
    const value = {
      size: { $format: { landscape: 100, portrait: 140, default: 120 } },
      list: [{ $format: { default: 'a', square: 'b' } }],
      deep: { $format: { portrait: { y: { $format: { portrait: 900, default: 0 } } }, default: { y: 10 } } },
    };
    const issues: ValidationError[] = [];

    expect(resolveMarkers(value, 'portrait', '', issues)).toEqual({ size: 140, list: ['a'], deep: { y: 900 } });
    expect(resolveMarkers(value, 'square', '', issues)).toEqual({ size: 120, list: ['b'], deep: { y: 10 } });
    expect(issues).toEqual([]);
  });

  it('reports a missing value, an unknown format key and a mixed marker object', () => {
    const issues: ValidationError[] = [];

    resolveMarkers(
      {
        a: { $format: { landscape: 1 } },
        b: { $format: { portrat: 1, default: 2 } },
        c: { $format: { default: 1 }, x: 1 },
      },
      'portrait',
      'root',
      issues
    );

    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['format_value_missing', 'root.a.$format'],
      ['format_marker_invalid', 'root.b.$format.portrat'],
      ['format_marker_mixed', 'root.c'],
    ]);
  });

  it('leaves the field unset when a marker has no value for the format', () => {
    expect(resolveMarkers({ a: { $format: { square: 1 } } }, 'portrait', '', [])).toEqual({});
  });
});

describe('resolveFormat', () => {
  it('returns a descriptor without formats untouched (same object)', () => {
    const plain = story();

    expect(usesFormats(plain)).toBe(false);
    expect(resolveFormat(plain).descriptor).toBe(plain);
    expect(resolveFormat(plain, 'portrait').descriptor.global.orientation).toBe('portrait');
  });

  it('applies the global and section patches of the rendering format only', () => {
    const descriptor = story({
      portrait: {
        global: { platform: 'shorts' },
        sections: {
          hook: { kinetic: { byId: { aside: { remove: true }, title: { size: 150 } } } },
          middle: { remove: true },
          end: { options: { duration: 1.5 } },
        },
      },
    });
    const portrait = resolveFormat(descriptor, 'portrait');
    const landscape = resolveFormat(descriptor);

    expect(portrait.issues).toEqual([]);
    expect(portrait.descriptor.global).toEqual({ orientation: 'portrait', musicEnabled: false, platform: 'shorts' });
    expect(portrait.descriptor.sections.map((s: Loose) => s.name)).toEqual(['hook', 'end']);
    expect(portrait.descriptor.sections[0].kinetic.map((k: Loose) => k.id)).toEqual(['title', undefined]);
    expect(portrait.descriptor.sections[0].kinetic[0].size).toBe(150);
    expect(portrait.descriptor.sections[1].options).toEqual({ backgroundColor: '#101010', duration: 1.5 });
    expect(portrait.descriptor).not.toHaveProperty('formats');
    expect(landscape.format).toBe('landscape');
    expect(landscape.descriptor.sections).toHaveLength(3);
    expect(descriptor.sections[0].kinetic).toHaveLength(3);
  });

  it('resolves markers in the base and inside the patch', () => {
    const descriptor = story({
      square: { sections: { end: { options: { duration: { $format: { square: 1.2, default: 9 } } } } } },
    });

    descriptor.sections[0].kinetic[0].size = { $format: { landscape: 100, square: 80 } };

    const square = resolveFormat(descriptor, 'square').descriptor;

    expect(square.sections[0].kinetic[0].size).toBe(80);
    expect(square.sections[2].options.duration).toBe(1.2);
  });

  it('reports an unknown section, override key or format, naming the format path', () => {
    const descriptor = story({ portrait: { sections: { hokk: { remove: true } }, meta: {} }, vertical: {} });
    const codes = resolveFormat(descriptor, 'portrait').issues.map((issue) => [issue.code, issue.path]);

    expect(codes).toEqual([
      ['format_unknown_format', 'formats.vertical'],
      ['format_unknown_override_key', 'formats.portrait.meta'],
      ['format_unknown_section', 'formats.portrait.sections.hokk'],
    ]);
    expect(() => resolveBuildFormat(descriptor, 'portrait')).toThrow(/formats\.portrait\.sections\.hokk/);
  });

  it('derives the base and declared formats from orientation, platform, formats and markers', () => {
    expect(baseFormat({ global: { platform: 'tiktok' } })).toBe('portrait');
    expect(baseFormat({})).toBe('landscape');
    expect(declaredFormats(story({ square: {} }))).toEqual(['landscape', 'square']);
    expect(declaredFormats({ global: { size: { $format: { portrait: 1, default: 2 } } } })).toEqual([
      'landscape',
      'portrait',
    ]);
  });
});

describe('per-format validation', () => {
  const validator = new TemplateValidator();

  it('validates each declared format and names the formats a finding belongs to', () => {
    const descriptor = story({
      portrait: { sections: { hook: { kinetic: { byId: { title: { size: -5 } } } } } },
      square: { sections: { hook: { kinetic: { byId: { title: { sizee: 5 } } } } } },
    });
    const result = validator.validateTemplate(descriptor);
    const messages = (result.errors ?? []).map((error) => `${error.code} ${error.path} ${error.message}`);

    expect(result.success).toBe(false);
    expect(messages.some((m) => m.includes('sections.0.kinetic.0.size') && m.includes('[portrait]'))).toBe(true);
    expect(messages.some((m) => m.startsWith('unknown_key') && m.includes('[square]'))).toBe(true);
    expect(messages.some((m) => m.includes('[landscape'))).toBe(false);
  });

  it('reports a finding every format shares once, untagged, and keeps the authored data', () => {
    const descriptor = story({ portrait: { global: { platform: 'shorts' } } });
    const valid = validator.validateTemplate(descriptor);

    expect(valid.success).toBe(true);
    expect(valid.data).toHaveProperty('formats');

    descriptor.sections[1].options.duration = -1;
    const errors = validator.validateTemplate(descriptor).errors ?? [];

    expect(errors.filter((error) => error.path === 'sections.1.options.duration')).toHaveLength(1);
    expect(errors.every((error) => !error.message.startsWith('['))).toBe(true);
  });

  it('accepts markers anywhere a value is expected, and validates a requested format alone', () => {
    const descriptor = story();

    descriptor.sections[0].kinetic[0].size = { $format: { landscape: 100, portrait: 150 } };

    expect(validator.validateTemplate(descriptor).success).toBe(true);
    expect(validator.validateTemplate(descriptor, { format: 'portrait' }).success).toBe(true);

    const square = validator.validateTemplate(descriptor, { format: 'square' });

    expect(square.errors?.map((error) => error.code)).toContain('format_value_missing');
  });

  it('flags a removed section a time reference still needs, in that format only', () => {
    const descriptor = story({ portrait: { sections: { hook: { kinetic: { byId: { title: { remove: true } } } } } } });

    descriptor.sections[0].kinetic[1].delay = 'title.end + 0.1';

    const errors = validator.validateTemplate(descriptor).errors ?? [];

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((error) => error.message.startsWith('[portrait]'))).toBe(true);
  });
});

describe('format advisories', () => {
  it('flags a declared format with no overrides at all (format_crop_only)', () => {
    const codes = formatAdvisories(story({ square: {}, portrait: { global: { platform: 'shorts' } } })).map((w) => [
      w.code,
      w.path,
    ]);

    expect(codes).toEqual([['format_crop_only', 'formats.square']]);
  });

  it('flags a format whose story diverges beyond explicit removals', () => {
    const renamed = story({ portrait: { sections: { middle: { name: 'other' } } } });
    const removed = story({ portrait: { sections: { middle: { remove: true } } } });

    expect(formatAdvisories(renamed).map((w) => w.code)).toEqual(['format_story_diverges']);
    expect(formatAdvisories(removed)).toEqual([]);
    expect(formatAdvisories(story())).toEqual([]);
  });

  it('surfaces through getMotionWarnings', () => {
    const codes = new TemplateValidator().getMotionWarnings(story({ square: {} })).map((w) => w.code);

    expect(codes).toContain('format_crop_only');
  });

  it('merges per-format findings, tagging only the partial ones', () => {
    const shared = { path: 'a', code: 'x', message: 'shared' };
    const own = { path: 'b', code: 'y', message: 'own' };

    expect(
      mergeFormatFindings([
        ['landscape', [shared]],
        ['portrait', [shared, own]],
      ])
    ).toEqual([shared, { ...own, message: '[portrait] own' }]);
  });
});

describe('catalog', () => {
  it('explains formats to agents', () => {
    const catalog = motionCatalog();

    expect(catalog.formats.syntax.marker).toContain('$format');
    expect(catalog.rules.some((rule) => rule.includes('One story, separate compositions'))).toBe(true);
  });
});
