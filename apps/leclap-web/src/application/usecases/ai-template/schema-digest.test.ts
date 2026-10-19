import { describe, expect, it } from 'vitest';
import { compactSchema } from './schema-digest';

describe('compactSchema: type "object" beside properties', () => {
  const digest = (schema: unknown) => JSON.parse(compactSchema(schema, 160));

  it('drops a bare object type that has properties, and keeps one without', () => {
    const out = digest({
      type: 'object',
      properties: { free: { type: 'object' }, n: { type: 'number' } },
    });

    expect(out.type).toBeUndefined();
    expect(out.properties.free).toEqual({ type: 'object' });
    expect(out.properties.n).toEqual({ type: 'number' });
  });

  it('keeps a property that is itself named type', () => {
    const out = digest({
      type: 'object',
      properties: { type: { type: 'string', enum: ['a', 'b'] } },
    });

    expect(out.properties.type).toEqual({ type: 'string', enum: ['a', 'b'] });
  });

  it('keeps a nullable object type', () => {
    const out = digest({ type: ['object', 'null'], properties: { a: { type: 'number' } } });

    expect(out.type).toEqual(['object', 'null']);
  });
});
