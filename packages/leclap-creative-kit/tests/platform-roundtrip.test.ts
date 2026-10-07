// global.platform has no builder control yet; opening a template in the builder and saving it must keep
// the delivery target (safe-zone warnings, duration limits, loudness) instead of silently dropping it.
import { describe, it, expect } from 'vitest';
import { buildDescriptor, toEditorState, type TemplateDescriptor } from '../src/editor/templateEditorModel';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';

function roundTrip(descriptor: TemplateDescriptor, orientation: 'landscape' | 'portrait' = 'portrait') {
  return buildDescriptor(toEditorState({ id: 't', name: 'T', description: '', orientation, descriptor }));
}

describe('global.platform round-trip through the editor', () => {
  it('keeps the platform and stays schema-valid', () => {
    const descriptor = {
      meta: { name: 'Reel' },
      global: { orientation: 'portrait', platform: 'tiktok', seed: 7 },
      sections: [{ name: 'hook', type: 'color_background', options: { backgroundColor: '#000000', duration: 3 } }],
    } as unknown as TemplateDescriptor;
    const state = toEditorState({ id: 't', name: 'Reel', description: '', orientation: 'portrait', descriptor });
    const back = buildDescriptor(state);

    expect(state.motion?.platform).toBe('tiktok');
    expect(back.global?.platform).toBe('tiktok');
    expect(back.global?.seed).toBe(7);
    expect(TemplateDescriptorSchema.safeParse(back).success).toBe(true);
  });

  it('keeps a platform alias verbatim', () => {
    const descriptor = {
      global: { orientation: 'portrait', platform: 'yt-shorts' },
      sections: [],
    } as unknown as TemplateDescriptor;

    expect(roundTrip(descriptor).global?.platform).toBe('yt-shorts');
  });

  it('adds no platform to a template without one', () => {
    const descriptor = { global: { orientation: 'landscape' }, sections: [] } as unknown as TemplateDescriptor;
    const state = toEditorState({ id: 't', name: 'T', description: '', orientation: 'landscape', descriptor });

    expect(state.motion).toBeUndefined();
    expect(roundTrip(descriptor, 'landscape').global).not.toHaveProperty('platform');
  });
});
