import { describe, expect, it } from 'vitest';
import type { TemplateDescriptor } from '@/core/types';
import {
  bindFieldContracts,
  fieldControl,
  fieldProblem,
  fieldSatisfied,
  unboundDeclaredFields,
} from './template-form-fields.logic';

const descriptor = {
  global: {
    fields: {
      ACCENT: { type: 'color', default: '#ff5a36', label: { en: 'Accent' } },
      HOLD: { type: 'number', min: 1, max: 8, default: 3 },
      MOOD: { type: 'enum', options: ['calm', 'loud'] },
      TITLE: { type: 'text', required: true },
    },
  },
  sections: [
    {
      name: 'f',
      type: 'form',
      options: {
        fields: [
          { name: 'TITLE', maxLength: 20, label: { en: 'Title' } },
          { name: 'city', maxLength: 30, label: { en: 'City' } },
        ],
      },
    },
  ],
} as unknown as TemplateDescriptor;

const formFields = [
  { name: 'TITLE', maxLength: 20, label: { en: 'Title' } },
  { name: 'city', maxLength: 30, label: { en: 'City' } },
];

describe('bindFieldContracts', () => {
  it('attaches the declared contract to the form field of the same name', () => {
    const bound = bindFieldContracts(formFields, descriptor);

    expect(bound[0].contract?.type).toBe('text');
    expect(bound[1].contract).toBeUndefined();
  });
});

describe('unboundDeclaredFields', () => {
  it('lists declared fields no form section asks for, labelled from the contract', () => {
    const extra = unboundDeclaredFields(descriptor, formFields);

    expect(extra.map((f) => f.name)).toEqual(['ACCENT', 'HOLD', 'MOOD']);
    expect(extra[0].label).toEqual({ en: 'Accent' });
    expect(extra[1].label).toEqual({ en: 'HOLD' });
  });
});

describe('fieldControl', () => {
  it('picks a control from the declared type, else from the text heuristics', () => {
    const [accent, hold, mood] = unboundDeclaredFields(descriptor, formFields);

    expect(fieldControl(accent)).toBe('color');
    expect(fieldControl(hold)).toBe('number');
    expect(fieldControl(mood)).toBe('select');
    expect(fieldControl({ name: 'description', label: {} })).toBe('textarea');
    expect(fieldControl({ name: 'city', label: {}, maxLength: 20 })).toBe('text');
  });
});

describe('fieldProblem and fieldSatisfied', () => {
  const [accent, hold, mood] = unboundDeclaredFields(descriptor, formFields);
  const [title, city] = bindFieldContracts(formFields, descriptor);

  it('lets a field with a default stay empty', () => {
    expect(fieldProblem(accent, '')).toBeNull();
    expect(fieldSatisfied(accent, '')).toBe(true);
  });

  it('requires a value for a plain form field, a required one, and an enum without default', () => {
    expect(fieldProblem(city, '')).toEqual({ kind: 'required' });
    expect(fieldProblem(title, ' ')).toEqual({ kind: 'required' });
    expect(fieldSatisfied(mood, '')).toBe(false);
  });

  it('checks the value against its type', () => {
    expect(fieldProblem(hold, '12')?.kind).toBe('invalid');
    expect(fieldProblem(hold, '4')).toBeNull();
    expect(fieldProblem(accent, '#zz')?.kind).toBe('invalid');
  });

  it('keeps the character budget', () => {
    expect(fieldProblem(city, 'x'.repeat(31))).toEqual({ kind: 'maxChars', max: 30 });
  });
});
