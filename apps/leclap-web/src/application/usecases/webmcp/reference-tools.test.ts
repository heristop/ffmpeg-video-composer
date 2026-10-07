import { describe, expect, it } from 'vitest';
import { textOf } from './results';
import { createFakePort, toolCaller } from './fake-port';

const call = toolCaller(createFakePort());

describe('get_template_schema', () => {
  it('returns the guide and an index of pointers when the whole schema is too large', async () => {
    const result = await call('get_template_schema');
    const text = textOf(result);

    expect(result.isError).toBeUndefined();
    expect(text).toContain('Builder guide (WebMCP)');
    expect(text).toContain('/properties/global');
    expect(text).toContain('section type color_background');
  });

  it('slices the schema by pointer', async () => {
    const result = await call('get_template_schema', { pointer: '/properties/meta' });

    expect(textOf(result)).toContain('JSON Schema:\n{');
    expect((await call('get_template_schema', { pointer: '/nope' })).data.code).toBe('not_found');
    expect((await call('get_template_schema', { pointer: 'no-slash' })).data.code).toBe('invalid_input');
  });
});

describe('get_motion_catalog', () => {
  it('ranks matches for a query and validates the kind', async () => {
    const result = await call('get_motion_catalog', { query: 'one punch word on the beat', kind: 'kinetic' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toHaveProperty('matches');
    expect((await call('get_motion_catalog', { query: 'x', kind: 'bogus' })).data.code).toBe('invalid_input');
  });

  it('returns the whole catalog without a query', async () => {
    const result = await call('get_motion_catalog');

    expect(JSON.parse(textOf(result))).toBeTypeOf('object');
  });
});

describe('samples', () => {
  it('lists samples with an openable flag and gets one with its partial catalog', async () => {
    const listed = await call('list_samples', { backend: 'native', category: 'templates' });
    const samples = listed.data.samples as Array<{ id: string; openable: boolean }>;

    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((sample) => typeof sample.openable === 'boolean')).toBe(true);

    const sample = await call('get_sample', { id: samples[0].id });

    expect(sample.data.id).toBe(samples[0].id);
    expect(sample.data.template).toBeTypeOf('object');
    expect((await call('get_sample', { id: 'missing' })).data.code).toBe('not_found');
  });
});
