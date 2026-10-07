import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TemplateValidator, type ValidationError } from '../src/services/TemplateValidator';
import { nearestKey } from '../src/services/validation/key-aliases';
import { findUnknownKeys } from '../src/services/validation/schema-walk';
import { editDistance, formatOptions, nearest } from '../src/services/validation/suggest';

const validator = new TemplateValidator();

function card(extra: Record<string, unknown> = {}, options: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'card',
    type: 'color_background',
    options: { backgroundColor: '#000000', duration: 3, ...options },
    ...extra,
  };
}

function errorsOf(template: unknown): ValidationError[] {
  return validator.validateTemplate(template).errors ?? [];
}

function finding(errors: ValidationError[], path: string): ValidationError | undefined {
  return errors.find((error) => error.path === path);
}

describe('suggestion helpers', () => {
  it('counts an adjacent transposition as one edit', () => {
    expect(editDistance('rize', 'rise')).toBe(1);
    expect(editDistance('fdae', 'fade')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('picks the nearest candidate within the typo budget, or nothing', () => {
    expect(nearest('rize', ['none', 'fade', 'rise'])).toBe('rise');
    expect(nearest('Ease_Out', ['linear', 'ease-out'])).toBe('ease-out');
    expect(nearest('in', ['up', 'down'])).toBeUndefined();
    expect(nearest('completely-different', ['fade', 'rise'])).toBeUndefined();
  });

  it('resolves keys by normalization, then aliases allowed at the path, then distance', () => {
    expect(nearestKey('font-size', ['fontsize', 'fontcolor'])).toBe('fontsize');
    expect(nearestKey('fontSize', ['size', 'color'])).toBe('size');
    expect(nearestKey('colour', ['color', 'size'])).toBe('color');
    expect(nearestKey('bgColor', ['backgroundColor', 'duration'])).toBe('backgroundColor');
    expect(nearestKey('ease', ['type', 'easing', 'delay'])).toBe('easing');
    expect(nearestKey('start', ['type', 'delay', 'duration'])).toBe('delay');
    expect(nearestKey('length', ['url', 'duration'])).toBe('duration');
    expect(nearestKey('durtion', ['url', 'duration'])).toBe('duration');
    expect(nearestKey('zzz', ['url', 'duration'])).toBeUndefined();
  });

  it('truncates long option lists', () => {
    const many = Array.from({ length: 20 }, (_, index) => `opt${index}`);

    expect(formatOptions(['a', 'b'])).toBe('"a", "b"');
    expect(formatOptions(many)).toContain('(+8 more)');
  });
});

describe('unknown keys', () => {
  it('reports a strict-object unknown key once per key, with a rename suggestion', () => {
    const section = card({}, { colour: '#fff', durration: 2 });
    delete (section.options as Record<string, unknown>).backgroundColor;
    delete (section.options as Record<string, unknown>).duration;
    const errors = errorsOf({ sections: [section] });

    expect(finding(errors, 'sections.0.options.colour')).toMatchObject({
      code: 'unknown_key',
      suggestion: 'backgroundColor',
      hint: 'Rename "colour" to "backgroundColor".',
      kind: 'format',
    });
    expect(finding(errors, 'sections.0.options.durration')).toMatchObject({
      code: 'unknown_key',
      suggestion: 'duration',
    });
  });

  it('does not mark a rename safe when the suggested key is already set', () => {
    const errors = errorsOf({ sections: [card({}, { colour: '#fff' })] });

    expect(finding(errors, 'sections.0.options.colour')).toMatchObject({
      code: 'unknown_key',
      suggestion: 'backgroundColor',
      kind: 'judgement',
    });
  });

  it('reports keys a strip object would silently drop', () => {
    const template = {
      sections: [card({ transition: { type: 'fade', length: 0.5 } }), card({ name: 'end' })],
    };
    const result = validator.validateTemplate(template);

    expect(result.success).toBe(false);
    expect(finding(result.errors ?? [], 'sections.0.transition.length')).toMatchObject({
      code: 'unknown_key',
      suggestion: 'duration',
    });
  });

  it('flags an unknown key on a section (a strip discriminated-union option)', () => {
    const errors = errorsOf({ sections: [card({ captoin: { text: { en: 'Hi' } } })] });

    expect(finding(errors, 'sections.0.captoin')).toMatchObject({ code: 'unknown_key', suggestion: 'caption' });
  });

  it('follows the discriminator into the matching option only', () => {
    const errors = errorsOf({
      sections: [
        {
          name: 'clip',
          type: 'video',
          options: { duration: 3 },
          motion: [
            { type: 'kenburns', zoom: 1.2 },
            { type: 'rotate', angle: 5, intensity: 1.1 },
          ],
        },
      ],
    });

    expect(finding(errors, 'sections.0.motion.0.zoom')).toMatchObject({ suggestion: 'intensity' });
    // `intensity` is a kenburns key; on a rotate entry it is unknown.
    expect(finding(errors, 'sections.0.motion.1.intensity')?.code).toBe('unknown_key');
    expect(finding(errors, 'sections.0.motion.0.direction')).toBeUndefined();
  });

  it('suggests the alias that exists at that path (start → delay inside a reveal)', () => {
    const errors = errorsOf({
      sections: [card({ caption: { text: { en: 'Hi' }, reveal: { type: 'rise', start: 0.2 } } })],
    });

    expect(finding(errors, 'sections.0.caption.reveal.start')).toMatchObject({ suggestion: 'delay' });
  });

  it('never flags records, raw filter values or comment keys', () => {
    const template = {
      $schema: './schema.json',
      _note: 'author comment',
      global: { variables: { anything: 'goes', other: ['a'] } },
      sections: [
        card({
          title: { en: 'Title', fr: 'Titre', xx: 'any locale' },
          filters: [{ type: 'drawtext', values: { text: { en: 'Hi' }, line_spacing: 4, fix_bounds: 1 } }],
        }),
      ],
    };
    const result = validator.validateTemplate(template);

    expect(result.errors).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('tolerates host fields at the descriptor top level, but not likely typos of real keys', () => {
    const hostField = validator.validateTemplate({ metadata: { owner: 'app' }, sections: [card()] });
    const typo = errorsOf({ section: [card()], sections: [card()] });

    expect(hostField.success).toBe(true);
    expect(finding(typo, 'section')).toMatchObject({ code: 'unknown_key', suggestion: 'sections' });
  });

  it('walks plain zod schemas too: wrappers, lazy, records and catchall', () => {
    const Leaf = z.object({ a: z.number() });
    const schema = z.object({
      wrapped: Leaf.optional().nullable(),
      lazy: z.lazy(() => Leaf),
      record: z.record(z.string(), Leaf),
      loose: z.object({ a: z.number() }).catchall(z.unknown()),
      list: z.array(Leaf),
    });
    const found = findUnknownKeys(schema, {
      wrapped: { a: 1, b: 2 },
      lazy: { c: 3 },
      record: { k: { a: 1 } },
      loose: { anything: true },
      list: [{ a: 1 }, { d: 4 }],
    });

    expect(found.map((entry) => `${entry.path.join('.')}:${entry.key}`)).toEqual(['wrapped:b', 'lazy:c', 'list.1:d']);
  });
});

describe('enum findings', () => {
  it('suggests the nearest allowed value and lists the options', () => {
    const errors = errorsOf({ sections: [card({ look: 'cinematik' })] });

    expect(finding(errors, 'sections.0.look')).toMatchObject({
      code: 'invalid_value',
      suggestion: 'cinematic',
      kind: 'format',
    });
    expect(finding(errors, 'sections.0.look')?.hint).toMatch(/^Use one of: "cinematic", /);
  });

  it('merges enum branches of a union (xfade names | "cut")', () => {
    const template = { sections: [card({ transition: { type: 'fadeblak' } }), card({ name: 'end' })] };
    const error = finding(errorsOf(template), 'sections.0.transition.type');

    expect(error).toMatchObject({ code: 'invalid_value', suggestion: 'fadeblack' });
    expect(error?.hint).toContain('more)');
  });

  it('resolves a reveal union to the enum branch for a string and the object branch for an object', () => {
    const asString = errorsOf({ sections: [card({ caption: { text: { en: 'Hi' }, reveal: 'rize' } })] });
    const asObject = errorsOf({
      sections: [card({ caption: { text: { en: 'Hi' }, reveal: { type: 'rise', easing: 'ease-outt' } } })],
    });

    expect(finding(asString, 'sections.0.caption.reveal')).toMatchObject({ suggestion: 'rise' });
    expect(finding(asObject, 'sections.0.caption.reveal.easing')).toMatchObject({ suggestion: 'ease-out' });
  });

  it('follows the graphics discriminator and suggests real keys for that graphic type', () => {
    const errors = errorsOf({
      sections: [card({ graphics: [{ type: 'underline', start: 0.4, easing: '$expo', thicknes: 4 }] })],
    });

    expect(finding(errors, 'sections.0.graphics.0.start')).toMatchObject({ suggestion: 'at' });
    expect(finding(errors, 'sections.0.graphics.0.easing')).toMatchObject({ suggestion: 'ease' });
    expect(finding(errors, 'sections.0.graphics.0.thicknes')).toMatchObject({ suggestion: 'thickness' });
  });

  it('attaches the nearest easing name to an easing grammar error', () => {
    const errors = errorsOf({ sections: [card({ graphics: [{ type: 'flash', ease: 'ease-out-expoo' }] })] });

    expect(finding(errors, 'sections.0.graphics.0.ease')).toMatchObject({
      suggestion: 'ease-out-expo',
      kind: 'format',
    });
  });

  it('turns an unmatched section type into an enum finding', () => {
    const error = finding(errorsOf({ sections: [{ name: 'x', type: 'colour_background' }] }), 'sections.0.type');

    expect(error).toMatchObject({ code: 'invalid_value', suggestion: 'color_background' });
  });

  it('leaves the suggestion out when nothing is close', () => {
    const error = finding(errorsOf({ sections: [card({ look: 'qwertyuiop' })] }), 'sections.0.look');

    expect(error?.suggestion).toBeUndefined();
    expect(error?.kind).toBe('judgement');
  });
});

describe('rule hints', () => {
  it('suggests a fitting transition duration', () => {
    const template = {
      sections: [card({ transition: { type: 'fade', duration: 2 } }, { duration: 1 }), card({ name: 'end' })],
    };
    const error = errorsOf(template).find((entry) => entry.code === 'transition_too_long');

    expect(error).toMatchObject({ suggestion: { type: 'fade', duration: 0.5 }, kind: 'judgement' });
  });

  it('suggests "cut" for a dangling transition', () => {
    const error = errorsOf({ sections: [card({ transition: { type: 'fade' } })] }).find(
      (entry) => entry.code === 'dangling_transition'
    );

    expect(error).toMatchObject({ suggestion: { type: 'cut' }, kind: 'format' });
  });

  it('suggests the nearest bundled font and section name', () => {
    const errors = errorsOf({
      sections: [
        card({ caption: { text: { en: 'Hi' }, font: 'oswlad' } }),
        { name: 'echo', type: 'video', options: { duration: 3, useVideoSection: 'crad' } },
      ],
    });

    expect(errors.find((entry) => entry.code === 'unknown_font')).toMatchObject({ suggestion: 'oswald' });
    expect(errors.find((entry) => entry.code === 'undefined_section_reference')).toMatchObject({
      suggestion: 'card',
      kind: 'format',
    });
  });

  it('suggests the nearest motion token', () => {
    const errors = errorsOf({ sections: [card({ graphics: [{ type: 'flash', ease: '$smoth' }] })] });

    expect(errors.find((entry) => entry.code === 'unknown_motion_token')).toMatchObject({
      suggestion: '$smooth',
      kind: 'format',
    });
  });

  it('checks a lone section against its own type (validateSection)', () => {
    const result = validator.validateSection({
      name: 'pic',
      type: 'image_background',
      options: { pictureURL: 'a.png' },
    });

    expect(result.success).toBe(false);
    expect(finding(result.errors ?? [], 'options.pictureURL')).toMatchObject({ suggestion: 'pictureUrl' });
  });

  it('reports schema and rule findings together once the parse succeeds', () => {
    const template = { sections: [card({ transition: { type: 'fade' }, captoin: {} })] };
    const codes = errorsOf(template).map((entry) => entry.code);

    expect(codes).toEqual(['unknown_key', 'dangling_transition']);
  });
});
