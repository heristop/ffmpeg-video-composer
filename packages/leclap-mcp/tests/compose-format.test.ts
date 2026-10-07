import { describe, expect, it } from 'vitest';
import { applyComposeFormat, formatArg } from '../src/compose/format.js';

const template = {
  global: { orientation: 'landscape' },
  sections: [
    {
      name: 'hook',
      type: 'color_background',
      options: { backgroundColor: '#000000', duration: { $format: { default: 3, portrait: 2 } } },
    },
    { name: 'extra', type: 'color_background', options: { backgroundColor: '#000000', duration: 1 } },
  ],
  formats: { portrait: { global: { platform: 'shorts' }, sections: { extra: { remove: true } } } },
};

describe('compose_video format', () => {
  it('resolves the template to the requested format before it is checked or rendered', () => {
    const result = applyComposeFormat({ template, format: 'portrait' as const });

    expect(result).not.toHaveProperty('isError');

    const resolved = (result as { template: Record<string, any> }).template;

    expect(resolved.global).toEqual({ orientation: 'portrait', platform: 'shorts' });
    expect(resolved.sections.map((section: { name: string }) => section.name)).toEqual(['hook']);
    expect(resolved.sections[0].options.duration).toBe(2);
    expect(resolved).not.toHaveProperty('formats');
  });

  it('resolves the base format when none is requested, and leaves plain templates alone', () => {
    const base = applyComposeFormat({ template }) as { template: Record<string, any> };
    const plain = { template: { sections: [] } };

    expect(base.template.sections).toHaveLength(2);
    expect(base.template.sections[0].options.duration).toBe(3);
    expect(applyComposeFormat(plain)).toBe(plain);
  });

  it('fails with the format problem, naming the field', () => {
    const broken = { ...template, formats: { square: { sections: { missing: { remove: true } } } } };
    const result = applyComposeFormat({ template: broken, format: 'square' as const });

    expect(result).toHaveProperty('isError', true);
    expect(JSON.stringify(result)).toContain('formats.square.sections.missing');
  });

  it('accepts only the three formats', () => {
    expect(formatArg.safeParse('square').success).toBe(true);
    expect(formatArg.safeParse('vertical').success).toBe(false);
  });
});
