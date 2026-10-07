import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { expandForBuild } from '@/director/prepare-build';
import { FieldResolutionError } from '@/core/fields';
import type AbstractLogger from '@/platform/logging/AbstractLogger';
import type { TemplateDescriptor } from '@/core/types';

const logger = { warn: vi.fn(), info: vi.fn() } as unknown as AbstractLogger;

const descriptor = {
  global: { fields: { HOLD: { type: 'number', default: 3 }, NAME: { type: 'text', required: true } } },
  sections: [
    {
      name: 'card',
      type: 'color_background',
      options: { backgroundColor: '#101014', duration: '{{ HOLD }}' },
      filters: [{ type: 'drawtext', values: { text: { en: 'Hi {{ NAME }}' } } }],
    },
  ],
} as unknown as TemplateDescriptor;

describe('expandForBuild with declared fields', () => {
  it('fills the build descriptor with the provided values', () => {
    const built = expandForBuild(descriptor, logger, undefined, { NAME: 'Ada', HOLD: '5' });
    const section = built.sections?.[0] as { options: { duration: unknown }; filters: unknown[] };

    expect(section.options.duration).toBe(5);
    expect(JSON.stringify(section.filters)).toContain('Hi Ada');
  });

  it('fails the build before any section renders when a value is missing or ill-typed', () => {
    expect(() => expandForBuild(descriptor, logger, undefined, {})).toThrow(FieldResolutionError);
    expect(() => expandForBuild(descriptor, logger, undefined, { NAME: 'Ada', HOLD: 'slow' })).toThrow(/HOLD/);
  });
});
