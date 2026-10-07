// Section intent (purpose, narrative role), the brief switches (meta.brief, meta.requirePurpose) and motion
// roles have no editor controls: opening a template in the builder and saving it must keep them.
import { describe, it, expect } from 'vitest';
import { buildDescriptor, toEditorState, type TemplateDescriptor } from '../src/editor/templateEditorModel';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';

const descriptor = {
  meta: { name: 'Intent', brief: 'brief.md', requirePurpose: true },
  global: {
    orientation: 'landscape',
    musicEnabled: false,
    motion: { roles: { headline: { ease: '$smooth', duration: 0.8 } } },
  },
  sections: [
    {
      name: 'hook',
      type: 'color_background',
      purpose: 'Stop the scroll with the promise.',
      role: 'hook',
      options: { backgroundColor: '#000000', duration: 3 },
      kinetic: [{ text: { en: 'Make it land.' }, preset: 'cascade', role: 'headline' }],
      camera: { preset: 'push-in', role: 'camera' },
    },
    { name: 'end', type: 'color_background', options: { backgroundColor: '#000000', duration: 2 } },
  ],
} as unknown as TemplateDescriptor;

function roundTrip(source: TemplateDescriptor): Record<string, any> {
  return buildDescriptor(
    toEditorState({ id: 't', name: 'Intent', description: '', orientation: 'landscape', descriptor: source })
  ) as Record<string, any>;
}

describe('section intent round-trip through the editor', () => {
  it('keeps purpose, role, the brief switches and motion roles, and stays schema-valid', () => {
    const back = roundTrip(descriptor);

    expect(back.meta).toMatchObject({ brief: 'brief.md', requirePurpose: true });
    expect(back.sections[0].purpose).toBe('Stop the scroll with the promise.');
    expect(back.sections[0].role).toBe('hook');
    expect(back.sections[0].kinetic[0].role).toBe('headline');
    expect(back.sections[0].camera).toEqual({ preset: 'push-in', role: 'camera' });
    expect(back.global.motion.roles).toEqual({ headline: { ease: '$smooth', duration: 0.8 } });
    expect(TemplateDescriptorSchema.safeParse(back).success).toBe(true);
  });

  it('adds no intent fields to a template without them', () => {
    const back = roundTrip({
      global: { orientation: 'landscape' },
      sections: [{ name: 'a', type: 'color_background', options: { duration: 2 } }],
    } as unknown as TemplateDescriptor);

    expect(back.sections[0]).not.toHaveProperty('purpose');
    expect(back.sections[0]).not.toHaveProperty('role');
    expect(back.meta ?? {}).not.toHaveProperty('brief');
    expect(back.meta ?? {}).not.toHaveProperty('requirePurpose');
  });
});
