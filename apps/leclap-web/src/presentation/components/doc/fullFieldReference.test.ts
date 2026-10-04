import { describe, expect, it } from 'vitest';
import { fullConstraints, fullReferenceGroups, recursiveFieldRows } from './fullFieldReference';
import { sectionTypeValues } from './schemaFields';

describe('complete schema reference', () => {
  it('includes every section type and nested native motion, text and overlay controls', () => {
    const groups = fullReferenceGroups();
    for (const type of sectionTypeValues()) {
      expect(
        groups.some((group) => group.name === `sections: ${type}`),
        type
      ).toBe(true);
    }
    const names = groups.flatMap((group) => group.rows.map((row) => row.name));
    for (const field of [
      '.titleCard.stagger',
      '.caption.reveal',
      '.easing',
      '.chromaKey.similarity',
      '.lowerThird',
      '.gradient',
      '.effect.props',
      '.effect.assets',
      '.options.motion',
    ]) {
      expect(
        names.some((name) => name.includes(field)),
        field
      ).toBe(true);
    }
  });
  it('shows complete enums, exclusive bounds and string/array limits', () => {
    expect(
      fullConstraints({
        enum: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        exclusiveMinimum: 0,
        multipleOf: 100,
        maxLength: 80,
        minItems: 3,
        maxItems: 3,
        pattern: '^x',
        additionalProperties: false,
      })
    ).toBe(
      'one of a, b, c, d, e, f, g · > 0 · length ≤ 80 · items ≥ 3 · items ≤ 3 · multiple of 100 · pattern ^x · unknown keys rejected'
    );
  });
  it('exposes font weight steps from the actual descriptor schema', () => {
    const rows = fullReferenceGroups().flatMap((group) => group.rows);
    expect(
      rows.some(
        (row) =>
          row.name.includes('.font') && row.name.endsWith('.weight') && row.constraints.includes('multiple of 100')
      )
    ).toBe(true);
  });

  it('keeps union variants distinct and requiredness local to their parent', () => {
    const rows = recursiveFieldRows(
      {
        type: 'object',
        properties: {
          options: {
            anyOf: [
              {
                type: 'object',
                properties: { type: { const: 'rotate' }, angle: { type: 'number' } },
                required: ['angle'],
              },
              { type: 'object', properties: { type: { const: 'flip' }, axis: { enum: ['horizontal', 'vertical'] } } },
            ],
          },
        },
      },
      'section'
    );
    expect(rows.find((row) => row.name === 'section.options (type=rotate).angle')?.required).toBe(true);
    expect(rows.find((row) => row.name === 'section.options')?.required).toBe(false);
    expect(rows.find((row) => row.name.endsWith('(type=flip).axis'))?.constraints).toContain('horizontal, vertical');
  });
  it('expands references once without looping on recursive JSON', () => {
    const root = { $defs: { value: { type: 'object', additionalProperties: { $ref: '#/$defs/value' } } } };
    const rows = recursiveFieldRows({ $ref: '#/$defs/value' }, 'props', root);
    expect(rows.map((row) => row.name)).toEqual(['props', 'props (expanded)', 'props (expanded)[key]']);
  });
});
