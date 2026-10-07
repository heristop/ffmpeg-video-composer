import { describe, expect, it } from 'vitest';
import { textOf } from './results';
import { STARTER_PRESETS, buildDescriptor } from '@leclap/creative-kit/editor';
import { createFakePort, toolCaller } from './fake-port';

const state = STARTER_PRESETS[0].build();
const call = toolCaller(createFakePort(state));

describe('validate_template', () => {
  it('validates the current draft in the MCP shape', async () => {
    const result = await call('validate_template');

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toMatch(/^Valid template — 3 section\(s\), landscape orientation\. Requires clips: video_1/);
    expect(result.data).toMatchObject({
      valid: true,
      revision: expect.stringMatching(/^[0-9a-f]{64}$/),
      sectionCount: 3,
      orientation: 'landscape',
      requiredClips: ['video_1'],
      formFields: [],
    });
  });

  it('reports every finding of an invalid candidate with path, code and hint', async () => {
    const candidate = buildDescriptor(state) as unknown as { sections: Array<Record<string, unknown>> };
    candidate.sections[0] = { ...candidate.sections[0], options: { duration: -1, backgroundColor: '#000' } };
    candidate.sections.push({ name: 'fx', type: 'effect', options: { duration: 2 } });
    const result = await call('validate_template', { template: candidate });

    expect(result.isError).toBe(true);
    expect(result.data.valid).toBe(false);
    const errors = result.data.errors as Array<{ code: string; path: string }>;
    expect(errors.some((error) => error.code === 'builder_unsupported_section')).toBe(true);
    expect(textOf(result)).toMatch(/^Invalid template \(\d+ finding\(s\)\):/);
  });

  it('warns about fields a candidate would lose in the builder, and declines render', async () => {
    const candidate = buildDescriptor(state) as unknown as { global: Record<string, unknown> };
    candidate.global.fps = 30;
    const result = await call('validate_template', { template: candidate, render: true });

    expect(result.data.advisories).toEqual([
      expect.objectContaining({ code: 'builder_dropped_field', pointers: ['/global/fps'] }),
    ]);
    expect(result.data.render).toMatchObject({ unavailable: expect.any(String) });
  });
});

describe('get_timeline', () => {
  it('returns the whole-video timeline for the draft and per format', async () => {
    const result = await call('get_timeline');

    expect(result.data.sections).toHaveLength(3);
    expect(result.data.duration).toBeGreaterThan(0);

    const portrait = await call('get_timeline', { format: 'portrait' });
    expect(portrait.data.height).toBeGreaterThan(portrait.data.width as number);
  });
});

describe('validate_template geometry', () => {
  it('measures text render-free with the page fonts and reports what does not fit', async () => {
    const port = createFakePort(state);
    const requested: string[] = [];
    port.loadFont = (file) => {
      requested.push(file);

      return Promise.resolve(null);
    };
    const candidate = buildDescriptor(state) as unknown as { sections: Array<Record<string, unknown>> };
    candidate.sections[0] = {
      ...candidate.sections[0],
      titleCard: { headline: { en: 'An extremely long headline that cannot possibly fit on one frame '.repeat(4) } },
    };
    const result = await toolCaller(port)('validate_template', { template: candidate });
    const geometry = result.data.geometry as Array<{ code: string }> | undefined;

    expect(result.isError).toBeUndefined();
    expect(geometry?.length).toBeGreaterThan(0);
    expect(requested.length).toBeGreaterThan(0);
  });
});
