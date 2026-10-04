import { describe, expect, it } from 'vitest';
import { TemplateDescriptorSchema } from '@/schemas/template.schemas';

describe('creative direction metadata', () => {
  it('retains an authoring brief without changing render settings', () => {
    const parsed = TemplateDescriptorSchema.parse({
      meta: { creativeDirection: '  Editorial launch. One hero per scene; quick rise, long hold.  ' },
      global: { orientation: 'landscape', musicEnabled: false },
    });
    expect(parsed.meta?.creativeDirection).toBe('Editorial launch. One hero per scene; quick rise, long hold.');
    expect(parsed.global).toMatchObject({ orientation: 'landscape', musicEnabled: false });
  });

  it.each([' ', 'x'.repeat(4001), { motion: 'rise' }, 42])('rejects an invalid brief: %j', (brief) => {
    expect(TemplateDescriptorSchema.safeParse({ meta: { creativeDirection: brief } }).success).toBe(false);
  });

  it('keeps existing descriptors valid when the brief is absent', () => {
    expect(TemplateDescriptorSchema.parse({ meta: { name: 'Legacy' } }).meta).toEqual({ name: 'Legacy' });
  });
});
