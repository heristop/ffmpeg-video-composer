import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';

function template(sections: unknown[], global: Record<string, unknown> = {}): unknown {
  return { meta: { name: 't' }, global: { orientation: 'landscape', fps: 30, ...global }, sections };
}

function color(name: string, duration: number, motion: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, type: 'color_background', options: { duration }, ...motion };
}

function kinetic(text: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { text: { en: text }, preset: 'rise', ...overrides };
}

// A calm, varied beat that triggers nothing on its own.
function calm(name: string, duration: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return color(name, duration, {
    camera: { preset: 'drift-left' },
    kinetic: [kinetic('Hello', { delay: 0.2 })],
    ...extra,
  });
}

function codes(descriptor: unknown): string[] {
  return new TemplateValidator().getMotionWarnings(descriptor).map((warning) => warning.code);
}

function warning(descriptor: unknown, code: string) {
  return new TemplateValidator().getMotionWarnings(descriptor).find((w) => w.code === code);
}

describe('getMotionWarnings', () => {
  it('is advisory: every pacing finding is a warn with a hint, and a valid template stays valid', () => {
    const descriptor = template([color('a', 3, { kinetic: [kinetic('One'), kinetic('Two'), kinetic('Three')] })]);
    const warnings = new TemplateValidator().getMotionWarnings(descriptor);

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((w) => w.severity === 'warn' && typeof w.hint === 'string')).toBe(true);
    expect(new TemplateValidator().validateTemplate(descriptor).success).toBe(true);
  });

  it('ease_monotony: more than two elements on one curve', () => {
    const same = template([
      calm('a', 3, { kinetic: [kinetic('One'), kinetic('Two', { delay: 0.5 }), kinetic('Three', { delay: 0.8 })] }),
    ]);
    const varied = template([
      calm('a', 3, {
        kinetic: [
          kinetic('One'),
          kinetic('Two', { delay: 0.5, ease: '$snappy' }),
          kinetic('Three', { delay: 0.8, preset: 'fade' }),
        ],
      }),
    ]);

    expect(warning(same, 'ease_monotony')?.message).toContain('3 elements share the curve cubic-bezier(0.16,1,0.3,1)');
    expect(codes(varied)).not.toContain('ease_monotony');
  });

  it('front_loaded: every entrance done in the first quarter of a long section', () => {
    const early = template([
      calm('a', 6, { kinetic: [kinetic('One'), kinetic('Two', { delay: 0.3, preset: 'fade' })] }),
    ]);
    const spread = template([
      calm('a', 6, { kinetic: [kinetic('One'), kinetic('Two', { delay: 3, preset: 'fade' })] }),
    ]);
    const short = template([
      calm('a', 2.5, { kinetic: [kinetic('One'), kinetic('Two', { delay: 0.3, preset: 'fade' })] }),
    ]);

    expect(warning(early, 'front_loaded')?.path).toBe('sections[0]');
    expect(codes(spread)).not.toContain('front_loaded');
    expect(codes(short)).not.toContain('front_loaded');
  });

  it('stagger_too_long: a short headline whose units start over more than 0.6 s', () => {
    const slow = template([calm('a', 4, { kinetic: [kinetic('Make every word land now', { stagger: 0.3 })] })]);
    const brisk = template([calm('a', 4, { kinetic: [kinetic('Make every word land now')] })]);
    const typed = template([calm('a', 4, { kinetic: [kinetic('Type it out', { preset: 'typewriter' })] })]);

    expect(warning(slow, 'stagger_too_long')).toMatchObject({ path: 'sections[0].kinetic[0]' });
    expect(warning(slow, 'stagger_too_long')?.message).toContain('1.2s for a 5-word headline');
    expect(codes(brisk)).not.toContain('stagger_too_long');
    expect(codes(typed)).not.toContain('stagger_too_long');
  });

  it('starts_at_zero: the first text entrance of a later section starts on the cut', () => {
    const onCut = template([calm('a', 3), calm('b', 3, { kinetic: [kinetic('Now', { delay: 0 })] })]);
    const offset = template([calm('a', 3), calm('b', 3)]);
    const first = template([calm('a', 3, { kinetic: [kinetic('Now', { delay: 0 })] }), calm('b', 3)]);

    expect(warning(onCut, 'starts_at_zero')?.path).toBe('sections[1].kinetic[0]');
    expect(codes(offset)).not.toContain('starts_at_zero');
    expect(codes(first)).not.toContain('starts_at_zero');
  });

  it('transition_monotony: every one of four or more boundaries uses the same transition', () => {
    const fades = [1, 2, 3, 4, 5].map((n) => calm(`s${n}`, 1 + n, { transition: { type: 'fade' } }));
    const accented = fades.map((section, i) => (i === 2 ? { ...section, transition: { type: 'iris' } } : section));
    const cuts = [1, 2, 3, 4, 5].map((n) => calm(`s${n}`, 1 + n));

    expect(warning(template(fades), 'transition_monotony')?.message).toBe('All 4 boundaries use "fade"');
    expect(codes(template(accented))).not.toContain('transition_monotony');
    expect(codes(template(cuts))).not.toContain('transition_monotony');
  });

  it('exit_before_transition: an exit that ends right before a non-cut boundary', () => {
    const block = kinetic('Bye', { exit: 'fade' });
    const pushed = template([calm('a', 3, { kinetic: [block], transition: { type: 'push-left' } }), calm('b', 3)]);
    const cut = template([calm('a', 3, { kinetic: [block] }), calm('b', 3)]);
    const early = template([
      calm('a', 3, { kinetic: [kinetic('Bye', { exit: { preset: 'fade', at: 1 } })], transition: { type: 'fade' } }),
      calm('b', 3),
    ]);

    expect(warning(pushed, 'exit_before_transition')?.path).toBe('sections[0].kinetic[0].exit');
    expect(codes(cut)).not.toContain('exit_before_transition');
    expect(codes(early)).not.toContain('exit_before_transition');
  });

  it('dead_air: a long still stretch on a colour or image background', () => {
    const still = template([color('a', 6, { kinetic: [kinetic('Hi')] })]);
    const drifting = template([calm('a', 6)]);
    const footage = template([{ name: 'v', type: 'video', options: { duration: 6 }, kinetic: [kinetic('Hi')] }]);

    expect(warning(still, 'dead_air')?.message).toMatch(/nothing moves for 5\.\d+s/);
    expect(codes(drifting)).not.toContain('dead_air');
    expect(codes(footage)).not.toContain('dead_air');
  });

  it('tempo_flat: four or more sections of nearly the same length', () => {
    const flat = template([calm('a', 3), calm('b', 3), calm('c', 3.5), calm('d', 3)]);
    const varied = template([calm('a', 1.5), calm('b', 3), calm('c', 5), calm('d', 2)]);
    const few = template([calm('a', 3), calm('b', 3), calm('c', 3)]);

    expect(warning(flat, 'tempo_flat')?.path).toBe('sections');
    expect(codes(varied)).not.toContain('tempo_flat');
    expect(codes(few)).not.toContain('tempo_flat');
  });

  it('never throws, even on malformed input', () => {
    expect(new TemplateValidator().getMotionWarnings(null)).toEqual([]);
    expect(new TemplateValidator().getMotionWarnings({ sections: [{ type: 'partial', ref: 'missing' }] })).toEqual([]);
  });
});
