import { describe, it, expect } from 'vitest';
import type { TemplateDescriptor } from '@/core/types';
import { expandPartials, expandPartialsSafe } from '@/core/partials';
import { TemplateValidator } from '@/services/TemplateValidator';

// The engine owns only the generic expansion mechanism: the registry of available partials travels in
// `descriptor.partials` (a catalog like @leclap/creative-kit merges its shared partials in before
// compiling). Inline partials (`{ type:'partial', sections }`) need no registry at all.

// expandPartials is typed against the schema-inferred descriptor; bridge the loosely-typed fixtures.
type Descriptor = Parameters<typeof expandPartials>[0];

const withPartials = (partials: unknown[], sections: unknown[]): Descriptor =>
  ({ partials, sections }) as unknown as Descriptor;

describe('expandPartials (engine mechanism)', () => {
  it('replaces a { type:"partial", ref } section with the referenced partial sections from descriptor.partials', () => {
    const descriptor = withPartials(
      [{ id: 'bumper', sections: [{ name: 'logo', type: 'project_video' }] }],
      [
        { name: 'b', type: 'partial', ref: 'bumper' },
        { name: 'q1', type: 'form' },
      ]
    );

    const sections = expandPartials(descriptor).sections ?? [];

    expect(sections.map((s) => s.type)).toEqual(['project_video', 'form']);
    expect(sections[0]?.name).toBe('logo');
  });

  it('expands an inline partial (sections) with no registry', () => {
    const descriptor = {
      sections: [{ type: 'partial', sections: [{ name: 'inline', type: 'form' }] }],
    } as unknown as Descriptor;

    const sections = expandPartials(descriptor).sections ?? [];

    expect(sections.map((s) => s.name)).toEqual(['inline']);
  });

  it('throws on a non-empty unknown partial ref', () => {
    const descriptor = withPartials([], [{ name: 'x', type: 'partial', ref: 'does-not-exist' }]);

    expect(() => expandPartials(descriptor)).toThrow(/does-not-exist/);
  });

  it('tolerates a malformed non-array `sections` without throwing (returns it unchanged)', () => {
    // A descriptor whose `sections` is a non-array (e.g. a string) must not crash `.some()` — the
    // engine's lenient compile() path normalizes it to "no sections" downstream rather than throwing.
    const stringSections = { sections: 'nope' } as unknown as Descriptor;
    expect(() => expandPartials(stringSections)).not.toThrow();
    expect(expandPartials(stringSections)).toBe(stringSections);

    const noSections = {} as Descriptor;
    expect(() => expandPartials(noSections)).not.toThrow();
    expect(expandPartials(noSections)).toBe(noSections);
  });

  it('drops an unconfigured (empty-ref) partial instead of throwing, keeping the other sections', () => {
    const descriptor = withPartials(
      [],
      [
        { name: 'clip', type: 'video' },
        { name: 'todo', type: 'partial', ref: '' },
      ]
    );

    expect(expandPartials(descriptor).sections).toEqual([{ name: 'clip', type: 'video' }]);
  });

  it('returns the descriptor unchanged when there are no partials (idempotent)', () => {
    const descriptor = { sections: [{ name: 'v', type: 'video' }] } as unknown as Descriptor;

    expect(expandPartials(descriptor)).toEqual(descriptor);
    expect(expandPartials(expandPartials(descriptor))).toEqual(descriptor);
  });

  it('applies an optional name prefix so the same partial can be used more than once', () => {
    const descriptor = withPartials(
      [{ id: 'bumper', sections: [{ name: 'logo', type: 'project_video' }] }],
      [{ name: 'intro', type: 'partial', ref: 'bumper', prefix: 'intro_' }]
    );

    expect(expandPartials(descriptor).sections?.[0]?.name).toBe('intro_logo');
  });

  it('substitutes {{ variable }} placeholders, ref overrides over partial defaults', () => {
    const descriptor = withPartials(
      [
        {
          id: 'card',
          variables: { optionA: 'THIS', optionB: 'THAT', conjunction: 'OR' },
          sections: [{ name: 'card', type: 'form', title: { en: '{{ optionA }} {{ conjunction }} {{ optionB }}' } }],
        },
      ],
      [{ type: 'partial', ref: 'card', prefix: 'q1_', variables: { optionA: 'Tea', optionB: 'Coffee' } }]
    );

    const out = expandPartials(descriptor);
    const json = JSON.stringify(out.sections);

    expect(json).toContain('Tea'); // ref override
    expect(json).toContain('Coffee'); // ref override
    expect(json).toContain('OR'); // partial default kept
    expect(json).not.toMatch(/\{\{\s*\w+\s*\}\}/); // nothing left unsubstituted
    expect(out.sections?.[0]?.name).toBe('q1_card');
  });
});

describe('expandPartialsSafe', () => {
  it('passes non-objects through untouched', () => {
    expect(expandPartialsSafe(null)).toEqual({ ok: true, data: null });
    expect(expandPartialsSafe(42)).toEqual({ ok: true, data: 42 });
  });

  it('turns an unknown-ref throw into a structured error', () => {
    const result = expandPartialsSafe(withPartials([], [{ name: 'x', type: 'partial', ref: 'nope' }]));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unknown_partial');
    }
  });
});

describe('TemplateValidator + partials', () => {
  it('expands a partial before schema validation and returns the expanded descriptor', () => {
    const descriptor = {
      partials: [{ id: 'bumper', sections: [{ name: 'logo', type: 'project_video' }] }],
      global: { orientation: 'landscape' },
      sections: [
        { name: 'b', type: 'partial', ref: 'bumper' },
        { name: 'form_1', type: 'form', options: { fields: [] } },
      ],
    };

    const result = new TemplateValidator().validateTemplate(descriptor);

    expect(result.success).toBe(true);
    const data = result.data as TemplateDescriptor | undefined;
    expect(data?.sections?.[0]?.type).toBe('project_video');
  });

  it('rejects an unknown partial ref with a clean error (not a crash)', () => {
    const result = new TemplateValidator().validateTemplate({
      partials: [],
      sections: [{ name: 'x', type: 'partial', ref: 'no-such-partial' }],
    });

    expect(result.success).toBe(false);
    expect(result.errors?.some((e) => e.message.includes('no-such-partial'))).toBe(true);
  });
});

describe('expandPartials nesting', () => {
  it('expands a partial that includes another partial', () => {
    const descriptor = withPartials(
      [
        { id: 'outer', sections: [{ name: 'o', type: 'partial', ref: 'inner' }] },
        { id: 'inner', sections: [{ name: 'logo', type: 'project_video' }] },
      ],
      [{ name: 'root', type: 'partial', ref: 'outer' }]
    );

    const expanded = expandPartials(descriptor);

    expect(expanded.sections).toEqual([{ name: 'logo', type: 'project_video' }]);
  });

  it('fails loudly on a partial that includes itself', () => {
    const descriptor = withPartials(
      [{ id: 'loop', sections: [{ name: 'again', type: 'partial', ref: 'loop' }] }],
      [{ name: 'root', type: 'partial', ref: 'loop' }]
    );

    expect(() => expandPartials(descriptor)).toThrow(/Cyclic template partial/);
  });
});
