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

  it('leaves the engine schema itself untouched', () => {
    expect(JSON.stringify(templateDescriptorJsonSchema)).toBe(full);
  });
});
