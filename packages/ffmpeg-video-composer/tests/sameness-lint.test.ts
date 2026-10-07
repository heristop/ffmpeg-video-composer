import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { DECOR_MAX_PER_SECTION, SAME_EFFECT_MAX_SECTIONS, samenessWarnings } from '@/services/sameness-lint';
import { librarySampleOf } from '@/core/motion/library-samples';

type Loose = Record<string, unknown>;

const SAMENESS = ['fx_untuned', 'effect_repeated', 'library_animation_sample', 'effect_off_theme', 'decor_overload'];

function template(sections: unknown[], global: Loose = {}): Loose {
  return { meta: { name: 't' }, global: { orientation: 'landscape', fps: 30, ...global }, sections };
}

function card(name: string, fields: Loose = {}): Loose {
  return { name, type: 'color_background', options: { duration: 3, backgroundColor: '#141416' }, ...fields };
}

function codes(descriptor: unknown, code: string) {
  return new TemplateValidator().getMotionWarnings(descriptor).filter((warning) => warning.code === code);
}

const TUNED_SHEEN = {
  type: 'fx',
  effect: 'sheen',
  target: { x: 100, y: 100, w: 400, h: 240, radius: 24 },
  profile: 'twin',
  width: 0.08,
  color: '$color.accent',
  at: 0.6,
};

describe('fx_untuned', () => {
  it('flags an fx that sets none of its look parameters, with a fix hint', () => {
    const [finding] = codes(
      template([card('a', { graphics: [{ type: 'fx', effect: 'sheen', at: 0.4 }] })]),
      'fx_untuned'
    );

    expect(finding).toMatchObject({ path: 'sections[0].graphics[0]', severity: 'warn' });
    expect(finding.hint).toContain('profile');
  });

  it('stays quiet once one look parameter is tuned', () => {
    expect(codes(template([card('a', { graphics: [TUNED_SHEEN] })], { theme: 'bold' }), 'fx_untuned')).toEqual([]);
    expect(
      codes(template([card('a', { graphics: [{ type: 'fx', effect: 'sheen', tilt: -20 }] })]), 'fx_untuned')
    ).toEqual([]);
  });
});

describe('effect_repeated', () => {
  it('flags one preset driving more than N sections and more than half of them', () => {
    const sections = Array.from({ length: SAME_EFFECT_MAX_SECTIONS + 1 }, (_, i) =>
      card(`s${i}`, { kinetic: [{ text: { en: 'Go' }, preset: 'rise' }] })
    );
    const [finding] = codes(template(sections), 'effect_repeated');

    expect(finding.message).toBe(`kinetic preset "rise" drives 4 of 4 sections`);
    expect(finding.path).toBe(`sections[${SAME_EFFECT_MAX_SECTIONS}]`);
  });

  it('allows a signature move on a minority of the sections', () => {
    const sections = Array.from({ length: 8 }, (_, i) =>
      card(`s${i}`, i < 4 ? { graphics: [{ ...TUNED_SHEEN }] } : { kinetic: [{ text: { en: 'Go' }, preset: 'fade' }] })
    );

    // Four of eight each: more than N, but not more than half.
    expect(codes(template(sections), 'effect_repeated')).toEqual([]);
  });
});

describe('library_animation_sample', () => {
  it('flags a library APNG input and a whole-video sample, naming the engine replacement', () => {
    const input = { name: 'shine', type: 'animation', url: '/assets/animations/shine_sweep.apng' };
    const descriptor = template([card('a', { inputs: [input] })], {
      animations: [{ url: 'animations/light_leak.apng' }],
    });
    const findings = codes(descriptor, 'library_animation_sample');

    expect(findings.map((w) => w.path)).toEqual(['global.animations[0]', 'sections[0].inputs[0]']);
    expect(findings[1].hint).toMatch(/^Sample asset, prefer composing with the motion engine: .*"sheen"/);
  });

  it('ignores user-supplied animations', () => {
    const input = { name: 'mine', type: 'animation', url: '{{ confettiUrl }}' };

    expect(codes(template([card('a', { inputs: [input] })]), 'library_animation_sample')).toEqual([]);
    expect(librarySampleOf('media://upload/42.webm')).toBeNull();
    expect(librarySampleOf('animations/unknown_thing.webm')).toEqual({ name: 'unknown_thing', sample: undefined });
  });
});

describe('effect_off_theme', () => {
  it('flags a literal effect colour in a themed template', () => {
    const fx = { ...TUNED_SHEEN, color: '#FF00FF' };
    const [finding] = codes(template([card('a', { graphics: [fx] })], { theme: 'bold' }), 'effect_off_theme');

    expect(finding.message).toContain('is a literal in a themed template');
    expect(finding.hint).toContain('$color.accent');
  });

  it('flags a colour used nowhere else in an unthemed template, not one from its palette', () => {
    const off = card('a', { graphics: [{ type: 'frame', color: '#00FF88' }] });
    const on = card('b', { graphics: [{ type: 'frame', color: '#151517' }] });

    expect(codes(template([off, on]), 'effect_off_theme').map((w) => w.path)).toEqual(['sections[0].graphics[0]']);
  });
});

describe('decor_overload', () => {
  it(`flags more than ${DECOR_MAX_PER_SECTION} decorative effects in one section`, () => {
    const graphics = [{ ...TUNED_SHEEN }, { type: 'flash', at: 0.2 }, { type: 'corners' }];
    const [finding] = codes(template([card('busy', { graphics })]), 'decor_overload');

    expect(finding.message).toBe('Section "busy" layers 3 decorative effects');
  });
});

describe('samenessWarnings', () => {
  it('is advisory only and never throws on odd input', () => {
    expect(samenessWarnings(null)).toEqual([]);
    expect(samenessWarnings({ sections: [{ type: 'color_background', graphics: 'nope' }] })).toEqual([]);

    const result = new TemplateValidator().validateTemplate(
      template([card('a', { graphics: [{ type: 'fx', effect: 'sheen' }] })])
    );

    expect(result.success).toBe(true);
  });

  it('every code carries a hint', () => {
    const descriptor = template(
      [
        card('a', {
          graphics: [
            { type: 'fx', effect: 'sheen', color: '#FF00FF' },
            { type: 'fx', effect: 'sheen', at: 1 },
            { type: 'flash' },
          ],
          inputs: [{ name: 'c', type: 'animation', url: 'animations/confetti.apng' }],
        }),
      ],
      { theme: 'bold' }
    );
    const found = samenessWarnings(descriptor);

    expect(new Set(found.map((w) => w.code))).toEqual(new Set(SAMENESS.filter((code) => code !== 'effect_repeated')));
    expect(found.every((w) => w.hint.length > 20)).toBe(true);
  });
});
