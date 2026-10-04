import { describe, it, expect } from 'vitest';
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import {
  typeLabel,
  constraintsLabel,
  fieldRows,
  docGroups,
  sectionTypeValues,
  type JsonSchemaNode,
} from './schemaFields';
import { examples } from './examples';

describe('typeLabel', () => {
  it('names arrays by their item type', () => {
    expect(typeLabel({ type: 'array', items: { type: 'string' } })).toBe('string[]');
  });

  it('collapses an anyOf union and surfaces a const', () => {
    const node: JsonSchemaNode = { anyOf: [{ type: 'string', enum: ['fade'] }, { const: 'cut' }] };
    expect(typeLabel(node)).toBe('string | "cut"');
  });
});

describe('constraintsLabel', () => {
  it('formats a numeric range and default', () => {
    expect(constraintsLabel({ type: 'number', minimum: 0, maximum: 1, default: 0.5 })).toBe('0…1 · default 0.5');
  });

  it('truncates long enums', () => {
    const node: JsonSchemaNode = { enum: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
    expect(constraintsLabel(node)).toContain('…');
  });
});

describe('fieldRows', () => {
  it('marks required properties and carries descriptions', () => {
    const node: JsonSchemaNode = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'the name' },
        opt: { type: 'number' },
      },
    };
    const rows = fieldRows(node);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'name', required: true, description: 'the name' });
    expect(rows[1].required).toBe(false);
  });
});

describe('docGroups', () => {
  it('produces non-empty, schema-driven rows for every documented group', () => {
    const ids = [
      'meta',
      'global',
      'globalAudio',
      'ducking',
      'section',
      'options',
      'inputs',
      'transition',
      'grade',
      'motion',
      'framingGuide',
      'layers',
      'caption',
      'filters',
      'filterValues',
      'maps',
      'audioFade',
    ] as const;

    for (const id of ids) {
      expect(docGroups[id]().length, `group ${id} rows`).toBeGreaterThan(0);
    }
  });

  it('keeps type-specific motion bounds separate', () => {
    const variants = docGroups.motionVariants();
    expect(variants).toHaveLength(6);
    const shake = variants.find((variant) => variant.name === 'shake');
    const pulse = variants.find((variant) => variant.name === 'pulse');
    expect(shake?.rows.find((row) => row.name === 'intensity')?.constraints).toContain('1…20');
    expect(pulse?.rows.find((row) => row.name === 'intensity')?.constraints).toContain('1.01…1.3');
  });

  it('unions options across section types (layers + framingGuide both surface)', () => {
    const names = docGroups.options().map((r) => r.name);
    expect(names).toContain('layers');
    expect(names).toContain('framingGuide');
  });
});

describe('sectionTypeValues', () => {
  it('lists every section type from the discriminated union', () => {
    const types = sectionTypeValues();
    for (const expected of [
      'video',
      'project_video',
      'form',
      'color_background',
      'image_background',
      'music',
      'partial',
    ]) {
      expect(types, expected).toContain(expected);
    }
  });
});

describe('example descriptors', () => {
  it('every documented example validates against the descriptor schema', () => {
    for (const example of examples) {
      const parsed = TemplateDescriptorSchema.safeParse(JSON.parse(example.json));
      expect(parsed.success, `${example.id}: ${parsed.error?.message}`).toBe(true);
    }
  });
});
