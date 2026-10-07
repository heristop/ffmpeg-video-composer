import { describe, it, expect } from 'vitest';
import {
  coerceFieldValue,
  declaredFields,
  resolveFields,
  FieldResolutionError,
  assertFieldsResolved,
} from '@/core/fields';
import { GlobalConfigSchema } from '@/schemas/template.schemas';

function card(options: Record<string, unknown>, text = '{{ TITLE }}') {
  return {
    name: 'card',
    type: 'color_background',
    options: { backgroundColor: '#101014', duration: 3, ...options },
    filters: [{ type: 'drawtext', values: { text: { en: text } } }],
  };
}

function template(fields: unknown, sections: unknown[] = [card({ duration: '{{ HOLD }}' })]) {
  return { global: { fields }, sections };
}

const FIELDS = {
  TITLE: { type: 'text', default: 'Hello', maxLength: 10 },
  HOLD: { type: 'number', default: 3, min: 1, max: 8 },
};

describe('global.fields schema', () => {
  it('accepts the map and the array form', () => {
    expect(GlobalConfigSchema.safeParse({ fields: FIELDS }).success).toBe(true);
    expect(GlobalConfigSchema.safeParse({ fields: [{ name: 'TITLE', type: 'text' }] }).success).toBe(true);
  });

  it('rejects an unknown type, an enum without options and a bad name', () => {
    expect(GlobalConfigSchema.safeParse({ fields: { A: { type: 'date' } } }).success).toBe(false);
    expect(GlobalConfigSchema.safeParse({ fields: { A: { type: 'enum' } } }).success).toBe(false);
    expect(GlobalConfigSchema.safeParse({ fields: [{ name: 'a b', type: 'text' }] }).success).toBe(false);
  });
});

describe('declaredFields', () => {
  it('normalises both forms to a named list', () => {
    expect(declaredFields({ fields: FIELDS }).map((f) => f.name)).toEqual(['TITLE', 'HOLD']);
    expect(declaredFields({ fields: [{ name: 'X', type: 'color' }] })).toEqual([{ name: 'X', type: 'color' }]);
    expect(declaredFields(undefined)).toEqual([]);
  });
});

describe('coerceFieldValue', () => {
  it('coerces numbers from strings and checks the range', () => {
    expect(coerceFieldValue({ name: 'N', type: 'number' }, '2.5')).toEqual({ ok: true, value: 2.5 });
    expect(coerceFieldValue({ name: 'N', type: 'number', max: 2 }, 3).ok).toBe(false);
    expect(coerceFieldValue({ name: 'N', type: 'number' }, 'fast').ok).toBe(false);
  });

  it('checks colours, enums, urls, media, text length and times', () => {
    expect(coerceFieldValue({ name: 'C', type: 'color' }, '#ff5a36').ok).toBe(true);
    expect(coerceFieldValue({ name: 'C', type: 'color' }, 'white').ok).toBe(true);
    expect(coerceFieldValue({ name: 'C', type: 'color' }, '#zzz').ok).toBe(false);
    expect(coerceFieldValue({ name: 'E', type: 'enum', options: ['a', 'b'] }, 'b').ok).toBe(true);
    expect(coerceFieldValue({ name: 'E', type: 'enum', options: ['a', 'b'] }, 'c').ok).toBe(false);
    expect(coerceFieldValue({ name: 'U', type: 'url' }, 'https://leclap.dev/x.png').ok).toBe(true);
    expect(coerceFieldValue({ name: 'U', type: 'url' }, 'not a url').ok).toBe(false);
    expect(coerceFieldValue({ name: 'M', type: 'media' }, 'clips/intro.mp4').ok).toBe(true);
    expect(coerceFieldValue({ name: 'M', type: 'media' }, '').ok).toBe(false);
    expect(coerceFieldValue({ name: 'T', type: 'text', maxLength: 3 }, 'abcd').ok).toBe(false);
    expect(coerceFieldValue({ name: 'S', type: 'time' }, '1:02.5')).toEqual({ ok: true, value: 62.5 });
    expect(coerceFieldValue({ name: 'S', type: 'time' }, -1).ok).toBe(false);
  });

  it('takes a custom coercer', () => {
    const upper = (raw: unknown) => ({ ok: true as const, value: String(raw).toUpperCase() });

    expect(coerceFieldValue({ name: 'T', type: 'text' }, 'hi', { text: upper })).toEqual({ ok: true, value: 'HI' });
  });
});

describe('resolveFields', () => {
  it('substitutes a whole-string placeholder with the typed value and interpolates text', () => {
    const { descriptor, issues } = resolveFields(template(FIELDS), { HOLD: '5' });
    const section = (descriptor as { sections: ReturnType<typeof card>[] }).sections[0];

    expect(issues).toEqual([]);
    expect(section.options.duration).toBe(5);
    expect(section.filters[0].values.text.en).toBe('Hello');
  });

  it('interpolates inside longer strings and leaves undeclared placeholders alone', () => {
    const { descriptor } = resolveFields(
      template(FIELDS, [card({}, '{{ TITLE }} by {{ author }}')]),
      { TITLE: 'Hi' },
      {}
    );

    expect(JSON.stringify(descriptor)).toContain('Hi by {{ author }}');
  });

  it('records the slots it filled', () => {
    const { substitutions } = resolveFields(template(FIELDS), {});

    expect(substitutions).toContainEqual({ path: 'sections.0.options.duration', field: 'HOLD', whole: true });
  });

  it('reports a provided value that fails its type and a missing required value', () => {
    const fields = { ...FIELDS, NAME: { type: 'text', required: true } };
    const { issues } = resolveFields(template(fields), { HOLD: '99' });

    expect(issues.map((i) => [i.field, i.code])).toEqual([
      ['HOLD', 'field_type_mismatch'],
      ['NAME', 'field_missing_required'],
    ]);
  });

  it('fills a missing value with a probe of its type in probe mode', () => {
    const fields = { HOLD: { type: 'number', min: 2 } };
    const { descriptor } = resolveFields(template(fields), {}, { probe: true });

    expect((descriptor as { sections: Array<{ options: { duration: unknown } }> }).sections[0].options.duration).toBe(
      2
    );
  });

  it('is a no-op without declared fields and idempotent once resolved', () => {
    const plain = { sections: [card({})] };

    expect(resolveFields(plain, {}).descriptor).toBe(plain);

    const once = resolveFields(template(FIELDS), {}).descriptor;

    expect(resolveFields(once, { HOLD: 7 }).descriptor).toEqual(once);
  });

  it('consumes the declarations instead of rewriting them', () => {
    const fields = { TITLE: { type: 'text', default: 'x', description: 'Shown as {{ TITLE }}' } };
    const { descriptor } = resolveFields(template(fields), {});

    expect((descriptor as { global: Record<string, unknown> }).global).toEqual({});
    expect(JSON.stringify(descriptor)).not.toContain('Shown as');
  });

  it('takes a custom encoder for interpolated values', () => {
    const { descriptor } = resolveFields(
      template(FIELDS, [card({}, 'say {{ TITLE }}')]),
      {},
      {
        encode: (value) => `<${String(value)}>`,
      }
    );

    expect(JSON.stringify(descriptor)).toContain('say <Hello>');
  });
});

describe('assertFieldsResolved', () => {
  it('throws a FieldResolutionError naming every issue', () => {
    expect(() => assertFieldsResolved(template(FIELDS), { HOLD: 'x' })).toThrow(FieldResolutionError);
    expect(() => assertFieldsResolved(template(FIELDS), { HOLD: 'x' })).toThrow(/HOLD/);
  });

  it('returns the resolved descriptor when every value fits', () => {
    const resolved = assertFieldsResolved(template(FIELDS), { HOLD: 4 }) as {
      sections: Array<{ options: { duration: number } }>;
    };

    expect(resolved.sections[0].options.duration).toBe(4);
  });
});
