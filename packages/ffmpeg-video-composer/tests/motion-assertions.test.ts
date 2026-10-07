import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { validateAssertions } from '@/services/motion-assertions';

function template(motion: Record<string, unknown>, duration: number | null = 4): unknown {
  return {
    meta: { name: 't' },
    global: { orientation: 'landscape', fps: 30 },
    sections: [
      {
        name: 'beat',
        type: 'color_background',
        options: duration === null ? {} : { duration },
        camera: { preset: 'drift-left' },
        ...motion,
      },
    ],
  };
}

const HEADLINE = { text: { en: 'Make it land' }, preset: 'rise', delay: 0.2, duration: 0.6 };
const SUPPORT = { text: { en: 'Then this' }, preset: 'fade', delay: 1.4, duration: 0.5 };

function failures(descriptor: unknown): string[] {
  const result = new TemplateValidator().validateTemplate(descriptor);

  return (result.errors ?? []).filter((e) => e.code === 'assertion_failed').map((e) => `${e.path}: ${e.message}`);
}

describe('section assert', () => {
  it('accepts the four assertion shapes at the schema and passes when the choreography holds', () => {
    const descriptor = template({
      kinetic: [HEADLINE, SUPPORT],
      assert: [
        { visibleBy: { target: 'kinetic[0]', at: 1.5 } },
        { before: ['kinetic[0]', 'kinetic[1]'] },
        { inFrame: 'kinetic[0]' },
        { keepsMoving: { maxStill: 1 } },
      ],
    });

    expect(new TemplateValidator().validateTemplate(descriptor).errors ?? []).toEqual([]);
  });

  it('rejects an unknown assertion at the schema', () => {
    expect(new TemplateValidator().validateTemplate(template({ assert: [{ eventually: 'x' }] })).success).toBe(false);
  });

  it('visibleBy fails with the measured completion time', () => {
    const [failure] = failures(
      template({ kinetic: [HEADLINE], assert: [{ visibleBy: { target: 'kinetic[0]', at: 0.5 } }] })
    );

    expect(failure).toMatch(
      /^sections\[0\]\.assert\[0\]: visibleBy: "kinetic\[0\]" finishes entering at 0\.\d+s, after the asserted 0\.5s$/
    );
  });

  it('before fails when the second element starts before the first has landed', () => {
    const [failure] = failures(
      template({ kinetic: [HEADLINE, { ...SUPPORT, delay: 0.4 }], assert: [{ before: ['kinetic[0]', 'kinetic[1]'] }] })
    );

    expect(failure).toContain('before: "kinetic[0]" finishes entering at');
    expect(failure).toContain('but "kinetic[1]" starts at 0.4s');
  });

  it('inFrame fails for a block pushed off the right edge, with the measured extent', () => {
    const [failure] = failures(
      template({ kinetic: [{ ...HEADLINE, align: 'left', x: 1100 }], assert: [{ inFrame: 'kinetic[0]' }] })
    );

    expect(failure).toMatch(/inFrame: "kinetic\[0\]" rests at x 1100–\d+, y \d+–\d+, outside the 1280x720 frame/);
  });

  it('keepsMoving fails on a still stretch, and is skipped (advisory) without a section duration', () => {
    const still = template({ camera: undefined, kinetic: [HEADLINE], assert: [{ keepsMoving: { maxStill: 1.5 } }] });
    const unknown = template(
      { camera: undefined, kinetic: [HEADLINE], assert: [{ keepsMoving: { maxStill: 1.5 } }] },
      null
    );

    expect(failures(still)[0]).toMatch(
      /keepsMoving: section "beat" is still for 3\.\d+s \(0\.\d+s–4s\), over the 1\.5s limit/
    );
    expect(failures(unknown)).toEqual([]);
    expect(new TemplateValidator().getMotionWarnings(unknown)).toContainEqual(
      expect.objectContaining({ code: 'assertion_skipped', severity: 'info', path: 'sections[0].assert[0]' })
    );
  });

  it('inFrame is skipped (advisory) when the box is not measurable render-free', () => {
    const counter = { text: { en: '0' }, preset: 'counter', counter: { from: 0, to: 9 } };
    const descriptor = template({ kinetic: [counter], assert: [{ inFrame: 'kinetic[0]' }] });

    expect(failures(descriptor)).toEqual([]);
    expect(new TemplateValidator().getMotionWarnings(descriptor).map((w) => w.code)).toContain('assertion_skipped');
  });

  it('fails a target that matches nothing, and treats a static element as visible from 0', () => {
    const drawtext = { type: 'drawtext', values: { text: { en: 'static' }, x: 10, y: 10 } };
    const descriptor = template({
      filters: [drawtext],
      kinetic: [HEADLINE],
      assert: [{ visibleBy: { target: 'nope', at: 1 } }, { before: ['filters[0]', 'kinetic[0]'] }],
    });

    expect(new TemplateValidator().validateTemplate(descriptor).errors?.map((e) => e.code)).toEqual([
      'assertion_failed',
    ]);
    expect(failures(descriptor)).toEqual([
      'sections[0].assert[0]: visibleBy: "nope" matches no element of section "beat" (use an id or a path like "kinetic[0]")',
    ]);
  });

  it('references elements by id when they carry one', () => {
    const descriptor = template({
      kinetic: [
        { ...HEADLINE, id: 'hero' },
        { ...SUPPORT, id: 'support' },
      ],
      assert: [{ before: ['support', 'hero'] }, { visibleBy: { target: 'hero', at: 2 } }],
    });
    const errors = validateAssertions(descriptor);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'assertion_failed', path: 'sections[0].assert[0]' });
    expect(errors[0].message).toMatch(/"support" finishes entering at 1\.9\d*s but "hero" starts at 0\.2s/);
  });
});
