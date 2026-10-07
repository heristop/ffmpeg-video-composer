import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import type { TemplateDescriptor } from '@/schemas/template.schemas';

const validator = new TemplateValidator();

function card(name: string, duration: unknown, text: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    type: 'color_background',
    options: { backgroundColor: '#101014', duration, ...extra },
    filters: [{ type: 'drawtext', values: { text: { en: text } } }],
  };
}

function fielded(fields: unknown, sections: unknown[]): unknown {
  return { global: { fields }, sections };
}

const BASE = {
  TITLE: { type: 'text', default: 'Hello' },
  HOLD: { type: 'number', default: 3 },
};

function codes(template: unknown, values?: Record<string, unknown>): string[] {
  return validator.getFieldWarnings(template as TemplateDescriptor, values).map((w) => w.code);
}

describe('validateTemplate with declared fields', () => {
  it('accepts a whole-string placeholder in a numeric slot and returns the authored descriptor', () => {
    const result = validator.validateTemplate(fielded(BASE, [card('a', '{{ HOLD }}', '{{ TITLE }}')]));
    const section = (result.data as TemplateDescriptor).sections?.[0] as { options: { duration: unknown } };

    expect(result.errors).toBeUndefined();
    expect(result.success).toBe(true);
    expect(section.options.duration).toBe('{{ HOLD }}');
  });

  it('reports a substituted value the slot rejects as field_type_mismatch at that slot', () => {
    const fields = { ...BASE, SHADE: { type: 'text', default: 'abc' } };
    const result = validator.validateTemplate(fielded(fields, [card('a', '{{ SHADE }}', '{{ TITLE }}')]));
    const finding = result.errors?.find((e) => e.path === 'sections.0.options.duration');

    expect(result.success).toBe(false);
    expect(finding?.code).toBe('field_type_mismatch');
    expect(finding?.message).toContain('SHADE');
    expect(finding?.hint).toBeDefined();
  });

  it('uses provided values in strict mode and fails on a missing required one', () => {
    const fields = { ...BASE, NAME: { type: 'text', required: true } };
    const template = fielded(fields, [card('a', '{{ HOLD }}', '{{ NAME }}')]);
    const strict = validator.validateTemplate(template, { fields: {} });
    const given = validator.validateTemplate(template, { fields: { NAME: 'Ada', HOLD: '6' } });
    const section = (given.data as TemplateDescriptor).sections?.[0] as { options: { duration: unknown } };

    expect(strict.success).toBe(false);
    expect(strict.errors?.map((e) => e.code)).toContain('field_missing_required');
    expect(given.success).toBe(true);
    expect(section.options.duration).toBe(6);
  });

  it('validates in probe mode when no values are given', () => {
    const fields = { HOLD: { type: 'number', required: true } };

    expect(validator.validateTemplate(fielded(fields, [card('a', '{{ HOLD }}', 'x')])).success).toBe(true);
  });

  it('accepts the documented example, with no advisory once its required title is given', () => {
    const example = {
      global: {
        fields: {
          TITLE: { type: 'text', required: true, maxLength: 32, label: { en: 'Title' } },
          ACCENT: { type: 'color', default: '#ff5a36' },
          HOLD: { type: 'number', default: 3, min: 1, max: 8 },
        },
      },
      sections: [
        {
          name: 'title',
          type: 'color_background',
          options: { backgroundColor: '{{ ACCENT }}', duration: '{{ HOLD }}' },
          titleCard: { headline: { en: '{{ TITLE }}' } },
        },
      ],
    };

    expect(validator.validateTemplate(example, { fields: { TITLE: 'Launch' } }).success).toBe(true);
    expect(codes(example, { TITLE: 'Launch' })).toEqual([]);
  });

  it('leaves a template without fields exactly as before', () => {
    const template = { global: { variables: { who: 'Ada' } }, sections: [card('a', 3, '{{ who }}')] };

    expect(validator.validateTemplate(template)).toEqual(new TemplateValidator().validateTemplate(template));
    expect(validator.getFieldWarnings(template as TemplateDescriptor)).toEqual([]);
  });
});

describe('getFieldWarnings', () => {
  it('flags a placeholder that names nothing, with the nearest field as a suggestion', () => {
    const warnings = validator.getFieldWarnings(
      fielded(BASE, [card('a', '{{ HOLD }}', '{{ TITEL }}')]) as TemplateDescriptor
    );
    const undefinedRef = warnings.find((w) => w.code === 'field_undefined');

    expect(undefinedRef?.path).toBe('sections[0].filters[0].values.text.en');
    expect(undefinedRef?.hint).toContain('TITLE');
  });

  it('knows variables, form fields and partial variables', () => {
    const template = {
      global: { fields: BASE, variables: { who: 'x' } },
      sections: [
        card('a', '{{ HOLD }}', '{{ TITLE }} {{ who }} {{ first }}'),
        { name: 'f', type: 'form', options: { fields: [{ name: 'first', maxLength: 10, label: { en: 'First' } }] } },
      ],
    };

    expect(codes(template)).toEqual([]);
  });

  it('flags a declared field nobody references', () => {
    expect(codes(fielded({ ...BASE, SPARE: { type: 'text' } }, [card('a', '{{ HOLD }}', '{{ TITLE }}')]))).toEqual([
      'field_unused',
    ]);
  });

  it('counts a form field binding as a use', () => {
    const template = fielded({ ...BASE, CITY: { type: 'text' } }, [
      card('a', '{{ HOLD }}', '{{ TITLE }}'),
      { name: 'f', type: 'form', options: { fields: [{ name: 'CITY', maxLength: 20, label: { en: 'City' } }] } },
    ]);

    expect(codes(template)).toEqual([]);
  });

  it('flags a default of the wrong type and a provided value of the wrong type', () => {
    const bad = { TITLE: BASE.TITLE, HOLD: { type: 'number', default: 'slow' } };
    const template = fielded(bad, [card('a', '{{ HOLD }}', '{{ TITLE }}')]);

    expect(codes(template)).toEqual(['field_type_mismatch']);
    expect(codes(fielded(BASE, [card('a', '{{ HOLD }}', '{{ TITLE }}')]), { HOLD: 'x' })).toEqual([
      'field_type_mismatch',
    ]);
  });

  it('flags a required field without a value, and a non-text field without a default', () => {
    const fields = { TITLE: { type: 'text', required: true }, HOLD: { type: 'number' } };
    const template = fielded(fields, [card('a', '{{ HOLD }}', '{{ TITLE }}')]);

    expect(codes(template)).toEqual(['field_missing_required', 'field_missing_required']);
    expect(codes(template, { TITLE: 'x', HOLD: 2 })).toEqual([]);
  });

  it('rides along with the motion warnings', () => {
    const template = fielded({ ...BASE, SPARE: { type: 'text' } }, [card('a', '{{ HOLD }}', '{{ TITLE }}')]);

    expect(validator.getMotionWarnings(template).some((w) => w.code === 'field_unused')).toBe(true);
  });

  it('replaces undefined_variable once fields are declared', () => {
    const template = { global: { fields: BASE, variables: { who: 'x' } }, sections: [card('a', 3, '{{ nope }}')] };

    expect(validator.getVariableWarnings(template as never)).toEqual([]);
  });
});
