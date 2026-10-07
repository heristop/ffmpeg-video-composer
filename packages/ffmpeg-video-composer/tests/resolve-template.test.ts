import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '@/services/resolve-template';

const template = {
  global: {
    fields: { HOLD: { type: 'number', default: 3 }, TITLE: { type: 'text', required: true } },
    variables: { brand: 'LeClap' },
  },
  sections: [
    {
      name: 'card',
      type: 'color_background',
      options: { backgroundColor: '#101014', duration: '{{ HOLD }}' },
      filters: [{ type: 'drawtext', values: { text: { en: '{{ TITLE }} · {{ brand }} · {{ city }}' } } }],
    },
    { name: 'f', type: 'form', options: { fields: [{ name: 'city', maxLength: 20, label: { en: 'City' } }] } },
  ],
};

type Resolved = { sections: Array<{ options: { duration?: unknown }; filters?: unknown[] }> };

describe('resolveTemplate', () => {
  it('returns the descriptor the build starts from: fields filled, variables and form values left to the render', () => {
    const result = resolveTemplate(template, { TITLE: 'Hi', HOLD: '4', city: 'Lyon' });
    const descriptor = result.descriptor as Resolved;

    expect(result.errors).toEqual([]);
    expect(result.values).toEqual({ HOLD: 4, TITLE: 'Hi' });
    expect(descriptor.sections[0].options.duration).toBe(4);
    expect(JSON.stringify(descriptor.sections[0].filters)).toContain('Hi · {{ brand }} · {{ city }}');
  });

  it('resolves the requested format, as the build does', () => {
    const formatted = {
      ...template,
      global: { ...template.global, orientation: 'landscape' },
      formats: { portrait: { global: { orientation: 'portrait' } } },
      sections: [
        {
          ...template.sections[0],
          options: { ...template.sections[0].options, duration: { $format: { portrait: 7, default: '{{ HOLD }}' } } },
        },
      ],
    };
    const descriptor = resolveTemplate(formatted, { TITLE: 'Hi' }, { format: 'portrait' }).descriptor as Resolved & {
      formats?: unknown;
    };

    expect(descriptor.sections[0].options.duration).toBe(7);
    expect(descriptor.formats).toBeUndefined();
  });

  it('reports what a render would refuse', () => {
    const result = resolveTemplate(template, { HOLD: 'x' });

    expect(result.errors.map((e) => e.code)).toEqual(['field_type_mismatch', 'field_missing_required']);
  });

  it('expands partials first', () => {
    const withPartial = {
      ...template,
      sections: [{ type: 'partial', sections: template.sections }],
    };
    const descriptor = resolveTemplate(withPartial, { TITLE: 'Hi' }).descriptor as Resolved;

    expect(descriptor.sections[0].options.duration).toBe(3);
  });
});
