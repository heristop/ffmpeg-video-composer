import { describe, expect, it } from 'vitest';
import { templateDescriptorJsonSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { promptSchema } from './prompt-schema';

describe('promptSchema', () => {
  const full = JSON.stringify(templateDescriptorJsonSchema);
  const trimmed = JSON.stringify(promptSchema(templateDescriptorJsonSchema));

  it('drops the composed-sound vocabulary (MCP agents author it), keeping library sound ids', () => {
    expect(full).toContain('#/$defs/Sound"');
    expect(trimmed).not.toContain('#/$defs/Sound');
    expect(trimmed).not.toContain('"SoundEnvelope"');
    expect(trimmed).toContain('"whoosh"');
    expect(trimmed.length).toBeLessThan(full.length);
  });

  it('requires a library id on every sound effect once the composed sound is gone', () => {
    const schema = promptSchema(templateDescriptorJsonSchema) as {
      properties: { global: { properties: { sfx: { items: Record<string, unknown> } } } };
    };
    const cue = schema.properties.global.properties.sfx.items;

    expect(cue.required).toEqual(['at', 'id']);
    expect(cue.oneOf).toBeUndefined();
    expect(Object.keys(cue.properties as object)).not.toContain('sound');
  });

  it('leaves the engine schema itself untouched', () => {
    expect(JSON.stringify(templateDescriptorJsonSchema)).toBe(full);
  });
});
