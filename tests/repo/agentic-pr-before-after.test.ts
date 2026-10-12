import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TemplateDescriptorSchema } from '../../packages/ffmpeg-video-composer/src/schemas/section.schemas';

const templatePath = resolve(import.meta.dirname, '../../examples/agentic-pr-video/before-after.json');

const load = (): {
  global: { variables: Record<string, string> };
  sections: { name: string; type: string; transition?: { type: string }; inputs?: { name: string; html?: string }[] }[];
} => JSON.parse(readFileSync(templatePath, 'utf8'));

describe('agentic PR before/after example', () => {
  it('is a valid LeClap template', () => {
    expect(TemplateDescriptorSchema.safeParse(load())).toMatchObject({ success: true });
  });

  it('names the change and states what was wrong, what changed and what to review', () => {
    expect(load().global.variables).toMatchObject({
      project: expect.any(String),
      change: expect.any(String),
      beforeCaption: expect.any(String),
      afterCaption: expect.any(String),
      reviewFocus: expect.any(String),
    });
  });

  it('plays a BEFORE recording, wipes to an AFTER recording, then hands back to review', () => {
    const sections = load().sections;
    const names = sections.map((section) => section.name);
    const before = sections.find((section) => section.name === 'before');
    const after = sections.find((section) => section.name === 'after');

    expect(names.indexOf('before')).toBeLessThan(names.indexOf('after'));
    expect(names.indexOf('after')).toBeLessThan(names.indexOf('review'));
    const badge = (section: typeof before): string | undefined =>
      section?.inputs?.find((input) => input.name === 'label')?.html;

    expect(before).toMatchObject({ type: 'project_video' });
    expect(after).toMatchObject({ type: 'project_video' });
    expect(badge(before)).toContain('>BEFORE<');
    expect(badge(after)).toContain('>AFTER<');
    expect(before?.transition?.type).toMatch(/^wipe/);
  });
});
