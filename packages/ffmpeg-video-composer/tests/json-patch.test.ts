import { describe, expect, it } from 'vitest';
import { applyJsonPatch, JsonPatchError, parsePointer } from '@/core/json-patch';

function patchError(run: () => unknown): JsonPatchError {
  try {
    run();
  } catch (error) {
    if (error instanceof JsonPatchError) return error;
    throw error;
  }
  throw new Error('expected a JsonPatchError');
}

describe('parsePointer (RFC 6901)', () => {
  it('splits and unescapes reference tokens', () => {
    expect(parsePointer('')).toEqual([]);
    expect(parsePointer('/')).toEqual(['']);
    expect(parsePointer('/a~1b/m~0n/~01')).toEqual(['a/b', 'm~n', '~1']);
    expect(parsePointer('/sections/0/options')).toEqual(['sections', '0', 'options']);
  });

  it('rejects bad syntax, reserved segments and deep pointers', () => {
    expect(patchError(() => parsePointer('a/b')).code).toBe('invalid_pointer');
    expect(patchError(() => parsePointer('/a~2')).code).toBe('invalid_pointer');
    expect(patchError(() => parsePointer('/a~')).code).toBe('invalid_pointer');
    expect(patchError(() => parsePointer('/__proto__/x')).code).toBe('unsafe_pointer');
    expect(patchError(() => parsePointer('/a/constructor')).code).toBe('unsafe_pointer');
    expect(patchError(() => parsePointer('/prototype')).code).toBe('unsafe_pointer');
    expect(patchError(() => parsePointer('/a'.repeat(65))).code).toBe('invalid_pointer');
    expect(parsePointer('/a'.repeat(64))).toHaveLength(64);
  });
});

describe('applyJsonPatch (RFC 6902 appendix A)', () => {
  it('A.1 adds an object member', () => {
    expect(applyJsonPatch({ foo: 'bar' }, [{ op: 'add', path: '/baz', value: 'qux' }])).toEqual({
      foo: 'bar',
      baz: 'qux',
    });
  });

  it('A.2 adds an array element and A.16 appends with "-"', () => {
    expect(applyJsonPatch({ foo: ['bar', 'baz'] }, [{ op: 'add', path: '/foo/1', value: 'qux' }])).toEqual({
      foo: ['bar', 'qux', 'baz'],
    });
    expect(applyJsonPatch({ foo: ['bar'] }, [{ op: 'add', path: '/foo/-', value: ['abc', 'def'] }])).toEqual({
      foo: ['bar', ['abc', 'def']],
    });
  });

  it('A.3 / A.4 remove an object member and an array element', () => {
    expect(applyJsonPatch({ baz: 'qux', foo: 'bar' }, [{ op: 'remove', path: '/baz' }])).toEqual({ foo: 'bar' });
    expect(applyJsonPatch({ foo: ['bar', 'qux', 'baz'] }, [{ op: 'remove', path: '/foo/1' }])).toEqual({
      foo: ['bar', 'baz'],
    });
  });

  it('A.5 replaces a value, keeping member order', () => {
    const result = applyJsonPatch({ baz: 'qux', foo: 'bar' }, [{ op: 'replace', path: '/baz', value: 'boo' }]);

    expect(result).toEqual({ baz: 'boo', foo: 'bar' });
    expect(Object.keys(result)).toEqual(['baz', 'foo']);
  });

  it('A.6 / A.7 move a value and an array element', () => {
    const doc = { foo: { bar: 'baz', waldo: 'fred' }, qux: { corge: 'grault' } };

    expect(applyJsonPatch(doc, [{ op: 'move', from: '/foo/waldo', path: '/qux/thud' }])).toEqual({
      foo: { bar: 'baz' },
      qux: { corge: 'grault', thud: 'fred' },
    });
    expect(
      applyJsonPatch({ foo: ['all', 'grass', 'cows', 'eat'] }, [{ op: 'move', from: '/foo/1', path: '/foo/3' }])
    ).toEqual({ foo: ['all', 'cows', 'eat', 'grass'] });
  });

  it('A.8 / A.9 test values, failing atomically', () => {
    const doc = { baz: 'qux', foo: ['a', 2, 'c'] };

    expect(
      applyJsonPatch(doc, [
        { op: 'test', path: '/baz', value: 'qux' },
        { op: 'test', path: '/foo/1', value: 2 },
      ])
    ).toEqual(doc);
    const error = patchError(() => applyJsonPatch({ baz: 'qux' }, [{ op: 'test', path: '/baz', value: 'bar' }]));
    expect(error).toMatchObject({ code: 'test_failed', index: 0, path: '/baz' });
  });

  it('A.10 adds a nested member object and A.14 handles escapes', () => {
    expect(applyJsonPatch({ foo: 'bar' }, [{ op: 'add', path: '/child', value: { grandchild: {} } }])).toEqual({
      foo: 'bar',
      child: { grandchild: {} },
    });
    expect(applyJsonPatch({ '/': 9, '~1': 10 }, [{ op: 'test', path: '/~01', value: 10 }])).toEqual({
      '/': 9,
      '~1': 10,
    });
    expect(applyJsonPatch({ '/': 9 }, [{ op: 'replace', path: '/~1', value: 1 }])).toEqual({ '/': 1 });
  });

  it('A.12 rejects adding to a nonexistent target', () => {
    const error = patchError(() => applyJsonPatch({ foo: 'bar' }, [{ op: 'add', path: '/baz/bat', value: 'qux' }]));

    expect(error).toMatchObject({ code: 'path_not_found', index: 0, path: '/baz/bat' });
  });

  it('A.15 compares strings and numbers strictly; deep-compares containers', () => {
    expect(patchError(() => applyJsonPatch({ '/': 9 }, [{ op: 'test', path: '/~1', value: '9' }])).code).toBe(
      'test_failed'
    );
    expect(
      applyJsonPatch({ a: { x: [1, { y: 2 }], z: null } }, [
        { op: 'test', path: '/a', value: { z: null, x: [1, { y: 2 }] } },
      ])
    ).toBeDefined();
    expect(patchError(() => applyJsonPatch({ a: [1] }, [{ op: 'test', path: '/a', value: { 0: 1 } }])).code).toBe(
      'test_failed'
    );
  });

  it('copies deeply so later edits do not alias the source', () => {
    const result = applyJsonPatch({ a: { list: [1] } }, [
      { op: 'copy', from: '/a', path: '/b' },
      { op: 'add', path: '/b/list/-', value: 2 },
    ]);

    expect(result).toEqual({ a: { list: [1] }, b: { list: [1, 2] } });
  });

  it('replaces and adds at the document root', () => {
    expect(applyJsonPatch({ a: 1 }, [{ op: 'replace', path: '', value: { b: 2 } }])).toEqual({ b: 2 });
    expect(applyJsonPatch({ a: 1 }, [{ op: 'add', path: '', value: [1] }])).toEqual([1]);
    expect(patchError(() => applyJsonPatch({ a: 1 }, [{ op: 'remove', path: '' }])).code).toBe('invalid_operation');
  });
});

describe('applyJsonPatch guards', () => {
  it('never mutates the input and applies nothing when a later operation fails', () => {
    const doc = { sections: [{ name: 'a' }, { name: 'b' }] };
    const before = structuredClone(doc);
    const error = patchError(() =>
      applyJsonPatch(doc, [
        { op: 'replace', path: '/sections/0/name', value: 'changed' },
        { op: 'remove', path: '/sections/1' },
        { op: 'remove', path: '/sections/5' },
      ])
    );

    expect(error).toMatchObject({ code: 'path_not_found', index: 2, path: '/sections/5' });
    expect(error.message).toContain('operation 2 (/sections/5)');
    expect(doc).toEqual(before);
  });

  it('does not alias inserted values', () => {
    const value = { nested: [1] };
    const result = applyJsonPatch<{ v?: { nested: number[] } }>({}, [{ op: 'add', path: '/v', value }]);
    value.nested.push(2);

    expect(result.v).toEqual({ nested: [1] });
  });

  it('validates array indices', () => {
    const doc = { list: [0, 1] };

    expect(applyJsonPatch(doc, [{ op: 'add', path: '/list/2', value: 2 }]).list).toEqual([0, 1, 2]);
    expect(patchError(() => applyJsonPatch(doc, [{ op: 'add', path: '/list/3', value: 3 }])).code).toBe(
      'path_not_found'
    );
    expect(patchError(() => applyJsonPatch(doc, [{ op: 'replace', path: '/list/01', value: 3 }])).code).toBe(
      'path_not_found'
    );
    expect(patchError(() => applyJsonPatch(doc, [{ op: 'remove', path: '/list/-' }])).code).toBe('path_not_found');
    expect(patchError(() => applyJsonPatch(doc, [{ op: 'replace', path: '/missing', value: 1 }])).code).toBe(
      'path_not_found'
    );
  });

  it('rejects malformed operations with their index', () => {
    const doc = { a: 1 };

    expect(patchError(() => applyJsonPatch(doc, [{ op: 'merge', path: '/a' }]))).toMatchObject({
      code: 'invalid_operation',
      index: 0,
    });
    expect(
      patchError(() =>
        applyJsonPatch(doc, [
          { op: 'test', path: '/a', value: 1 },
          { op: 'add', path: '/b' },
        ])
      )
    ).toMatchObject({ code: 'invalid_operation', index: 1, path: '/b' });
    expect(patchError(() => applyJsonPatch(doc, [{ op: 'move', path: '/b' }])).code).toBe('invalid_operation');
    expect(patchError(() => applyJsonPatch(doc, ['nope'])).code).toBe('invalid_operation');
    expect(patchError(() => applyJsonPatch(doc, { op: 'add' } as unknown as unknown[])).code).toBe('invalid_patch');
  });

  it('rejects moving a value into its own child', () => {
    expect(patchError(() => applyJsonPatch({ a: { b: {} } }, [{ op: 'move', from: '/a', path: '/a/b/c' }])).code).toBe(
      'invalid_operation'
    );
    expect(applyJsonPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/a' }])).toEqual({ a: 1 });
  });

  it('rejects prototype-polluting pointers and values', () => {
    expect(patchError(() => applyJsonPatch({}, [{ op: 'add', path: '/__proto__/polluted', value: 1 }])).code).toBe(
      'unsafe_pointer'
    );
    const value = JSON.parse('{"__proto__": {"polluted": true}}') as unknown;

    expect(patchError(() => applyJsonPatch({}, [{ op: 'add', path: '/x', value }])).code).toBe('unsafe_value');
    expect(patchError(() => applyJsonPatch({}, [{ op: 'copy', from: '/constructor', path: '/x' }])).code).toBe(
      'unsafe_pointer'
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('bounds value depth and the number of operations', () => {
    let deep: unknown = 1;

    for (let i = 0; i < 70; i++) deep = { d: deep };

    expect(patchError(() => applyJsonPatch({}, [{ op: 'add', path: '/x', value: deep }])).code).toBe('unsafe_value');
    const ops = Array.from({ length: 3 }, () => ({ op: 'test', path: '', value: {} }));

    expect(applyJsonPatch({}, ops, { maxOps: 3 })).toEqual({});
    expect(patchError(() => applyJsonPatch({}, ops, { maxOps: 2 }))).toMatchObject({
      code: 'too_many_operations',
      index: -1,
    });
  });
});
