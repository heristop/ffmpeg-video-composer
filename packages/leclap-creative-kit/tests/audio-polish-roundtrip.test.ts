// Audio polish fields with no editor controls yet (voice presets, volume automation, sound effects) must be
// carried through untouched: opening a template in the builder and saving it may never strip them.
import { describe, it, expect } from 'vitest';
import { buildDescriptor, toEditorState, type TemplateDescriptor } from '../src/editor/templateEditorModel';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { SFX_ITEMS } from '../src/sfx';

const descriptor = {
  global: {
    orientation: 'landscape',
    musicEnabled: false,
    sfx: [{ id: 'ding', at: 'end - 1.5' }],
    audio: {
      sourceVolume: 1,
      musicVolume: 0.5,
      sfx: 'auto',
      automation: [
        { at: 0, volume: 1 },
        { at: 'cue:drop', volume: 0.3, ease: '$snappy' },
      ],
    },
  },
  sections: [
    {
      name: 'clip',
      type: 'video',
      options: {
        duration: 3,
        voice: 'clean',
        audioAutomation: [{ at: 1, volume: 0.5 }],
      },
      cues: { drop: 1.5 },
      sfx: [{ id: 'hit', at: 'cue:drop', volume: 0.6 }],
    },
  ],
} as unknown as TemplateDescriptor;

describe('audio polish round-trip through the editor', () => {
  it('keeps voice, automation and sound effects', () => {
    const state = toEditorState({ id: 't', name: 'Audio', description: '', orientation: 'landscape', descriptor });
    const back = buildDescriptor(state) as Record<string, any>;
    const source = descriptor as Record<string, any>;

    expect(back.global.sfx).toEqual(source.global.sfx);
    expect(back.global.audio.sfx).toBe('auto');
    expect(back.global.audio.automation).toEqual(source.global.audio.automation);
    expect(back.sections[0].options.voice).toBe('clean');
    expect(back.sections[0].options.audioAutomation).toEqual([{ at: 1, volume: 0.5 }]);
    expect(back.sections[0].sfx).toEqual(source.sections[0].sfx);
    expect(TemplateDescriptorSchema.safeParse(source).success).toBe(true);
  });

  it('adds nothing to a template without them', () => {
    const plain = { global: { orientation: 'landscape' }, sections: [] } as unknown as TemplateDescriptor;
    const back = buildDescriptor(
      toEditorState({ id: 't', name: 'T', description: '', orientation: 'landscape', descriptor: plain })
    );

    expect(back.global).not.toHaveProperty('sfx');
    expect(back.global?.audio).not.toHaveProperty('automation');
  });
});

describe('sound-effect library listing', () => {
  it('lists every bundled sound with its kit path and license', () => {
    expect(SFX_ITEMS.map((item) => item.path)).toContain('sfx/riser.m4a');
    expect(SFX_ITEMS.every((item) => item.useWhen.length > 0 && item.license.startsWith('CC0'))).toBe(true);
  });
});
