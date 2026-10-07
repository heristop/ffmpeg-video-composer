import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { MOTION_BLUEPRINTS } from '@/core/motion/catalog-blueprints';
import { SECTION_ROLES } from '@/schemas/section-intent.schemas';
import { TemplateDescriptorSchema } from '@/schemas/template.schemas';

type Loose = Record<string, unknown>;

function template(sections: unknown[], meta: Loose = { name: 't' }): Loose {
  return { meta, global: { orientation: 'landscape', fps: 30 }, sections };
}

function color(name: string, duration: number, fields: Loose = {}): Loose {
  return { name, type: 'color_background', options: { duration }, ...fields };
}

function warnings(descriptor: unknown, code: string) {
  return new TemplateValidator().getMotionWarnings(descriptor).filter((warning) => warning.code === code);
}

function graphic(type: string, at: number, ease: string): Loose {
  return { type, at, ease };
}

describe('overshoot_overuse', () => {
  it('fires when more than half of three or more entrances overshoot', () => {
    const bouncy = template([
      color('a', 4, {
        graphics: [
          graphic('underline', 0.2, '$bouncy'),
          graphic('corners', 0.6, '$juicy'),
          graphic('panel', 1, '$expo'),
        ],
      }),
    ]);
    const [finding] = warnings(bouncy, 'overshoot_overuse');

    expect(finding.path).toBe('sections[0]');
    expect(finding.message).toContain('2 of 3 entrances overshoot');
    expect(finding.hint).toContain('keep overshoot for one or two playful elements'.replace('keep', 'Keep'));
  });

  it('stays quiet for one playful element among settling ones, and under three entrances', () => {
    const one = template([
      color('a', 4, {
        graphics: [
          graphic('underline', 0.2, '$bouncy'),
          graphic('corners', 0.6, '$expo'),
          graphic('panel', 1, '$smooth'),
        ],
      }),
    ]);
    const two = template([
      color('a', 4, { graphics: [graphic('underline', 0.2, '$bouncy'), graphic('corners', 0.6, 'ease-out-back')] }),
    ]);

    expect(warnings(one, 'overshoot_overuse')).toEqual([]);
    expect(warnings(two, 'overshoot_overuse')).toEqual([]);
  });

  it('settles when the elements take settling roles', () => {
    const roles = template([
      color('a', 4, {
        graphics: [
          { type: 'underline', at: 0.2, role: 'micro' },
          { type: 'corners', at: 0.6, role: 'panel' },
          { type: 'panel', at: 1, role: 'mascot' },
        ],
      }),
    ]);

    expect(warnings(roles, 'overshoot_overuse')).toEqual([]);
  });
});

describe('headline_hold_short', () => {
  const copy = { en: 'Four words land here' };

  it('fires when a headline preset lands too close to the cut', () => {
    const [finding] = warnings(
      template([color('a', 1.6, { kinetic: [{ text: copy, preset: 'cascade' }] })]),
      'headline_hold_short'
    );

    expect(finding.path).toBe('sections[0].kinetic[0]');
    expect(finding.message).toMatch(/4-word headline holds .* \(needs 1\.54s\)/);
  });

  it('measures the hold up to an exit', () => {
    const exits = template([
      color('a', 6, { kinetic: [{ text: copy, preset: 'rise', exit: { preset: 'fade', at: 1.2 } }] }),
    ]);

    expect(warnings(exits, 'headline_hold_short')).toHaveLength(1);
  });

  it('stays quiet once the headline holds long enough', () => {
    expect(
      warnings(template([color('a', 5, { kinetic: [{ text: copy, preset: 'cascade' }] })]), 'headline_hold_short')
    ).toEqual([]);
  });

  it('follows the role: headline on any preset or title card, never a non-headline role', () => {
    const tagged = template([
      color('a', 1.2, {
        kinetic: [
          { text: copy, preset: 'fade', role: 'headline' },
          { text: copy, preset: 'cascade', role: 'accent' },
        ],
      }),
      color('b', 1.4, { titleCard: { headline: { en: 'A five word title card' }, role: 'headline' } }),
    ]);

    expect(warnings(tagged, 'headline_hold_short').map((w) => w.path)).toEqual([
      'sections[0].kinetic[0]',
      'sections[1].titleCard',
    ]);
  });
});

describe('section purpose', () => {
  const sections = [
    color('hook', 2, { purpose: 'Stop the scroll.', role: 'hook' }),
    color('proof', 3),
    { name: 'form', type: 'form' },
  ];

  it('is authoring metadata the schema accepts on every section', () => {
    expect(TemplateDescriptorSchema.safeParse(template(sections, { brief: 'brief.md' })).success).toBe(true);
    expect(TemplateDescriptorSchema.safeParse(template([color('a', 2, { role: 'climax' })])).success).toBe(false);
  });

  it('stays silent unless the template opts in', () => {
    expect(warnings(template(sections), 'section_without_purpose')).toEqual([]);
    expect(
      warnings(template(sections, { brief: 'brief.md', requirePurpose: false }), 'section_without_purpose')
    ).toEqual([]);
  });

  it('flags rendering sections without purpose once meta.brief or meta.requirePurpose asks for it', () => {
    for (const meta of [{ brief: 'Launch film for the beta' }, { requirePurpose: true }]) {
      const found = warnings(template(sections, meta), 'section_without_purpose');

      expect(found.map((w) => w.path)).toEqual(['sections[1]']);
      expect(found[0].severity).toBe('warn');
    }
  });

  it('accepts every blueprint role as a section role', () => {
    for (const blueprint of MOTION_BLUEPRINTS) {
      for (const role of blueprint.roles) expect(SECTION_ROLES).toContain(role);
    }
  });
});
