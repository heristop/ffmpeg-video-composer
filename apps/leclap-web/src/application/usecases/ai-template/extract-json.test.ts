import { describe, expect, it } from 'vitest';
import { extractJsonObject, findJsonObject } from './extract-json';

describe('extractJsonObject', () => {
  it('parses a bare object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('strips markdown fences and surrounding prose', () => {
    const reply = 'Here you go:\n```json\n{"sections": [{"name": "intro"}]}\n```\nEnjoy!';

    expect(extractJsonObject(reply)).toEqual({ ok: true, value: { sections: [{ name: 'intro' }] } });
  });

  it('ignores braces inside strings and trailing notes', () => {
    const reply = String.raw`Sure. {"text":"a } tricky { string \" with quote","n":{"m":2}} — notes {not json}`;

    expect(extractJsonObject(reply)).toEqual({
      ok: true,
      value: { text: 'a } tricky { string " with quote', n: { m: 2 } },
    });
  });

  it('reports a truncated object', () => {
    const result = extractJsonObject('{"sections": [{"name": "intro"');

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(/truncated/);
  });

  it('reports an empty reply and a non-object', () => {
    expect(extractJsonObject('   ')).toEqual({ ok: false, error: 'The reply was empty.' });
    expect(extractJsonObject('{"a": [1, 2,]}').ok).toBe(false);
  });

  it('findJsonObject returns the first balanced span', () => {
    expect(findJsonObject('x {"a":{"b":1}} {"c":2}')).toBe('{"a":{"b":1}}');
    expect(findJsonObject('no json')).toBeNull();
  });
});
