import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, vi } from 'vitest';
import { assertFieldsResolved, coerceFieldValue, resolveFields, FieldResolutionError } from '@/core/fields';
import { TemplateValidator } from '@/services/TemplateValidator';
import { resolveTemplateEffects } from '@/core/resolve-template-effects';
import { expandForBuild } from '@/director/prepare-build';
import Template from '@/core/models/Template';
import type AbstractLogger from '@/platform/logging/AbstractLogger';
import type { TemplateDescriptor } from '@/schemas/template.schemas';
import type { TemplateField } from '@/schemas/fields.schemas';

const logger = { warn: vi.fn(), info: vi.fn() } as unknown as AbstractLogger;
const validator = new TemplateValidator();

function card(options: Record<string, unknown> = {}, values: Record<string, unknown> = { text: { en: 'x' } }) {
  return {
    name: 'card',
    type: 'color_background',
    options: { backgroundColor: '#101014', duration: 3, ...options },
    filters: [{ type: 'drawtext', values }],
  };
}

function fielded(fields: unknown, sections: unknown[]): Record<string, unknown> {
  return { global: { fields }, sections };
}

type Built = {
  sections: Array<{ options: Record<string, unknown>; filters?: Array<{ values: Record<string, unknown> }> }>;
};

const COLOR: TemplateField = { name: 'C', type: 'color' };

function color(raw: unknown) {
  return coerceFieldValue(COLOR, raw);
}

const ffmpegAvailable = spawnSync('ffmpeg', ['-version']).status === 0;

function ffmpegAccepts(value: string): boolean {
  const args = ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${value}`, '-frames:v', '1', '-f', 'null', '-'];

  return spawnSync('ffmpeg', args).status === 0;
}

describe('colour coercion follows the FFmpeg colour grammar', () => {
  it('normalises short hex and rgb()/rgba() to #rrggbb[aa]', () => {
    expect(color('#fff')).toEqual({ ok: true, value: '#ffffff' });
    expect(color('#f008')).toEqual({ ok: true, value: '#ff000088' });
    expect(color('rgb(1, 2, 3)')).toEqual({ ok: true, value: '#010203' });
    expect(color('rgba(255,0,0,0.5)')).toEqual({ ok: true, value: '#ff000080' });
  });

  it('keeps full hex, 0x hex, FFmpeg names and an @alpha', () => {
    expect(color('#ff5a36')).toEqual({ ok: true, value: '#ff5a36' });
    expect(color('0xff5a36')).toEqual({ ok: true, value: '0xff5a36' });
    expect(color('#ff000080')).toEqual({ ok: true, value: '#ff000080' });
    expect(color('#ff0000@0.5')).toEqual({ ok: true, value: '#ff0000@0.5' });
    expect(color('LightGrey')).toEqual({ ok: true, value: 'LightGrey' });
    expect(color('red@1')).toEqual({ ok: true, value: 'red@1' });
  });

  it('rejects what FFmpeg rejects', () => {
    for (const bad of ['foo', 'LightGray', 'transparent', 'red@1.5', 'rgb(256,0,0)', 'rgb(1,2)', '#12345', 'random']) {
      expect(color(bad).ok, bad).toBe(false);
    }
  });

  it.skipIf(!ffmpegAvailable)('produces values the real ffmpeg colour source accepts', () => {
    for (const input of ['#fff', '#f008', 'rgb(1,2,3)', 'rgba(255,0,0,0.5)', '#ff0000@0.5', 'LightGrey', 'red@0.25']) {
      const coerced = color(input);

      expect(coerced.ok && ffmpegAccepts(String(coerced.value)), input).toBe(true);
    }

    for (const rejected of ['foo', 'LightGray', 'red@1.5']) expect(ffmpegAccepts(rejected), rejected).toBe(false);
  });
});

describe('number, time, url and text coercion edge cases', () => {
  const number: TemplateField = { name: 'N', type: 'number' };
  const time: TemplateField = { name: 'T', type: 'time' };
  const url: TemplateField = { name: 'U', type: 'url' };

  it('rejects hex, binary and octal number literals', () => {
    for (const bad of ['0x10', '0b11', '0o7', 'Infinity']) {
      expect(coerceFieldValue(number, bad).ok, bad).toBe(false);
      expect(coerceFieldValue(time, bad).ok, bad).toBe(false);
    }

    expect(coerceFieldValue(number, ' -2.5 ')).toEqual({ ok: true, value: -2.5 });
    expect(coerceFieldValue(number, '1e3')).toEqual({ ok: true, value: 1000 });
  });

  it('rejects clock seconds (and minutes under hours) of 60 or more', () => {
    expect(coerceFieldValue(time, '1:75').ok).toBe(false);
    expect(coerceFieldValue(time, '1:60:00').ok).toBe(false);
    expect(coerceFieldValue(time, '1:05')).toEqual({ ok: true, value: 65 });
    expect(coerceFieldValue(time, '1:02:03.5')).toEqual({ ok: true, value: 3723.5 });
  });

  it('allows only http, https, data, media and relative URLs', () => {
    for (const good of [
      'https://leclap.dev/x.png',
      'http://a.b/c',
      'data:image/png;base64,AA',
      'media://k1',
      'img/logo.png',
      '/x.png',
    ]) {
      expect(coerceFieldValue(url, good).ok, good).toBe(true);
    }

    for (const bad of [['javascript', 'alert(1)'].join(':'), 'file:///etc/passwd', 'ftp://x/y', 'not a url', '']) {
      expect(coerceFieldValue(url, bad).ok, bad).toBe(false);
    }
  });

  it('treats a whitespace-only value as empty', () => {
    const fields = { TITLE: { type: 'text', default: 'Hello' }, NAME: { type: 'text', required: true } };
    const resolved = resolveFields(fielded(fields, [card()]), { TITLE: '   ', NAME: ' \t ' });

    expect(resolved.values.TITLE).toBe('Hello');
    expect(resolved.issues.map((issue) => issue.code)).toEqual(['field_missing_required']);
  });

  it('labels a failing default as the default even when an empty value was passed', () => {
    const fields = { HOLD: { type: 'number', default: 'slow' } };
    const [issue] = resolveFields(fielded(fields, [card()]), { HOLD: '' }).issues;

    expect(issue.message).toContain('the default');
  });
});

describe('whole-string substitution respects the slot type', () => {
  it('keeps a number as text in a string-only slot, and as a number in a numeric one', () => {
    const fields = { PRICE: { type: 'number', default: 9.5 } };
    const template = fielded(fields, [card({ duration: '{{ PRICE }}' }, { text: { en: '{{ PRICE }}' } })]);
    const built = assertFieldsResolved(template, {}) as unknown as Built;

    expect(built.sections[0].options.duration).toBe(9.5);
    expect(built.sections[0].filters?.[0].values.text).toEqual({ en: '9.5' });
    expect(validator.validateTemplate(template, { fields: {} }).success).toBe(true);
  });

  it('fills a numeric slot from a numeric-looking enum option', () => {
    const fields = { HOLD: { type: 'enum', options: ['2', '4'], default: '4' } };
    const template = fielded(fields, [card({ duration: '{{ HOLD }}' })]);
    const built = assertFieldsResolved(template, {}) as unknown as Built;

    expect(built.sections[0].options.duration).toBe(4);
    expect(validator.validateTemplate(template, { fields: {} }).success).toBe(true);
  });
});

describe('resolution is idempotent', () => {
  it('never re-scans substituted text', () => {
    const fields = { TITLE: { type: 'text' }, HOLD: { type: 'number', default: 3 } };
    const template = fielded(fields, [card({ duration: '{{ HOLD }}' }, { text: { en: '{{ TITLE }}' } })]);
    const once = assertFieldsResolved(template, { TITLE: '{{ HOLD }}' });
    const twice = assertFieldsResolved(once, { TITLE: 'other', HOLD: 7 }) as unknown as Built;

    expect(twice).toEqual(once);
    expect(twice.sections[0].filters?.[0].values.text).toEqual({ en: '{{ HOLD }}' });
  });
});

describe('field values in raw filter values', () => {
  const fields = { LEVEL: { type: 'text', default: '10' } };

  it('refuses filtergraph separators in a raw filter value', () => {
    const template = fielded(fields, [card({}, { text: { en: 'x' }, fontsize: '{{ LEVEL }}' })]);
    const resolved = resolveFields(template, { LEVEL: '10,movie=/etc/passwd' });

    expect(resolved.issues.map((issue) => issue.field)).toEqual(['LEVEL']);
    expect(JSON.stringify(resolved.descriptor)).not.toContain('movie=');
    expect(() => assertFieldsResolved(template, { LEVEL: '10,movie=/etc/passwd' })).toThrow(FieldResolutionError);
    expect(
      (assertFieldsResolved(template, { LEVEL: '24' }) as unknown as Built).sections[0].filters?.[0].values.fontsize
    ).toBe('24');
  });

  it('lets the same value into a text slot', () => {
    const template = fielded(fields, [card({}, { text: { en: 'Level {{ LEVEL }}' } })]);

    expect(resolveFields(template, { LEVEL: '10,movie=/etc/passwd' }).issues).toEqual([]);
  });
});

describe('validation hands back the authored descriptor in probe mode', () => {
  const fields = { HOLD: { type: 'number', default: 3 }, TITLE: { type: 'text' }, C: { type: 'color' } };
  const template = fielded(fields, [
    card({ duration: '{{ HOLD }}', backgroundColor: '{{ C }}' }, { text: { en: '{{ TITLE }}' } }),
  ]);
  const values = { HOLD: '6', TITLE: 'Hi', C: '#ff0000' };

  it('returns placeholders, not probe stand-ins, without values', () => {
    const result = validator.validateTemplate(template);
    const data = result.data as unknown as Built;

    expect(result.success).toBe(true);
    expect(data.sections[0].options.duration).toBe('{{ HOLD }}');
    expect(data.sections[0].options.backgroundColor).toBe('{{ C }}');
  });

  it('lets the build fill the validated descriptor with the values given later', () => {
    const data = validator.validateTemplate(template).data as TemplateDescriptor;
    const built = expandForBuild(data, logger, undefined, values) as unknown as Built;

    expect(built.sections[0].options).toMatchObject({ duration: 6, backgroundColor: '#ff0000' });
    expect(built.sections[0].filters?.[0].values.text).toEqual({ en: 'Hi' });
  });

  it('keeps Template.setDescriptor unresolved', () => {
    const model = new Template();

    expect(model.setDescriptor(template).success).toBe(true);

    const built = expandForBuild(model.descriptor, logger, undefined, values) as unknown as Built;

    expect(built.sections[0].options.duration).toBe(6);
  });

  it('keeps effect resolution unresolved, so the build still takes the values', async () => {
    const resolved = await resolveTemplateEffects(template, () => {
      throw new Error('no effects here');
    });
    const built = expandForBuild(resolved.descriptor, logger, undefined, values) as unknown as Built;

    expect(built.sections[0].options.duration).toBe(6);
  });

  it('returns a consumed, renderable descriptor in strict mode', () => {
    const data = validator.validateTemplate(template, { fields: values }).data as TemplateDescriptor;
    const built = expandForBuild(data, logger, undefined, { HOLD: '2' }) as unknown as Built;

    expect(built.sections[0].options.duration).toBe(6);
  });
});

describe('field findings at a slot', () => {
  it('reports a missing required field once, not again as the reference it left', () => {
    const fields = { CLIP: { type: 'text', required: true } };
    const template = fielded(fields, [
      { name: 'clip', type: 'video', options: { duration: 2 } },
      card({ useVideoSection: '{{ CLIP }}' }),
    ]);
    const errors = validator.validateTemplate(template, { fields: {} }).errors ?? [];

    expect(errors.map((error) => error.code)).toEqual(['field_missing_required']);
  });

  it('retags a bracket-path finding the field produced', () => {
    const fields = { CLIP: { type: 'text', default: 'nowhere' } };
    const template = fielded(fields, [
      { name: 'clip', type: 'video', options: { duration: 2 } },
      card({ useVideoSection: '{{ CLIP }}' }),
    ]);
    const errors = validator.validateTemplate(template, { fields: {} }).errors ?? [];

    expect(errors.map((error) => error.code)).toEqual(['field_type_mismatch']);
    expect(errors[0].message).toContain('CLIP');
  });

  it('leaves an unknown key alone', () => {
    const fields = { HOLD: { type: 'number', default: 3 } };
    const template = fielded(fields, [card({ duration: '{{ HOLD }}', bogus: '{{ HOLD }}' })]);
    const errors = validator.validateTemplate(template).errors ?? [];

    expect(errors.map((error) => error.code)).toEqual(['unknown_key']);
  });
});

describe('form field character budget', () => {
  const fields = { HOLD: { type: 'number', default: 3 }, TITLE: { type: 'text' } };

  function form(formFields: unknown[]) {
    return fielded(fields, [
      card({ duration: '{{ HOLD }}' }, { text: { en: '{{ TITLE }}' } }),
      { name: 'f', type: 'form', options: { fields: formFields } },
    ]);
  }

  it('needs no maxLength on a form field bound to a non-text declared field', () => {
    const result = validator.validateTemplate(form([{ name: 'HOLD', label: { en: 'Hold' } }]));

    expect(result.errors).toBeUndefined();
  });

  it('still needs one on a text or unbound form field', () => {
    const errors = validator.validateTemplate(
      form([
        { name: 'TITLE', label: { en: 'Title' } },
        { name: 'city', label: { en: 'City' } },
      ])
    ).errors;

    expect(errors?.map((error) => error.path)).toEqual([
      'sections.1.options.fields.0.maxLength',
      'sections.1.options.fields.1.maxLength',
    ]);
  });

  it('still needs one without declared fields', () => {
    const template = {
      sections: [{ name: 'f', type: 'form', options: { fields: [{ name: 'x', label: { en: 'X' } }] } }],
    };

    expect(validator.validateTemplate(template).success).toBe(false);
  });
});
