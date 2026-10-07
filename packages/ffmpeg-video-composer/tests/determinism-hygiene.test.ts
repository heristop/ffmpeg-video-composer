import { describe, expect, it } from 'vitest';
import { findNondeterministicExpressions } from '@/core/determinism/hygiene';
import { TemplateValidator } from '@/services/TemplateValidator';

function card(filters: unknown[], meta: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    meta,
    global: { orientation: 'landscape', musicEnabled: false },
    sections: [
      { name: 'card', type: 'color_background', options: { backgroundColor: '#101010', duration: 2 }, filters },
    ],
  };
}

describe('findNondeterministicExpressions', () => {
  it('finds wall-clock expansions in drawtext text and clock/random calls in expressions', () => {
    const findings = findNondeterministicExpressions(
      card([
        { type: 'drawtext', values: { text: { en: 'Today %{localtime\\:%Y}' }, x: '10', y: '10' } },
        { type: 'drawbox', values: { x: 'mod(time(0),100)', y: 0, w: 10, h: 10 } },
        { type: 'drawtext', values: { text: { en: 'x' }, x: '100*random(0)', y: '0' } },
        { type: 'drawtext', values: { text: { en: '%{gmtime}' }, x: '0', y: '0' } },
      ])
    );

    expect(findings.map((finding) => finding.token)).toEqual(['%{localtime', 'time(', 'random(', '%{gmtime']);
    expect(findings[0].path).toBe('sections[0].filters[0].values.text.en');
  });

  it('ignores lookalikes and text outside filters', () => {
    const descriptor = card(
      [{ type: 'drawtext', values: { text: { en: 'runtime(3) and showtime' }, x: '0', y: '0' } }],
      {
        description: 'Uses %{localtime} in prose only',
      }
    );

    expect(findNondeterministicExpressions(descriptor)).toEqual([]);
  });

  it('scans map and input filter chains too', () => {
    const descriptor = card([]) as { sections: Array<Record<string, unknown>> };
    descriptor.sections[0].maps = [
      { inputs: ['0:v'], outputs: ['out'], filters: [{ type: 'drawtext', values: { text: { en: '%{localtime}' } } }] },
    ];

    expect(findNondeterministicExpressions(descriptor)).toHaveLength(1);
  });
});

describe('validator: nondeterministic_expression', () => {
  const validator = new TemplateValidator();
  const clocky = [{ type: 'drawtext', values: { text: { en: '%{localtime}' }, x: '0', y: '0' } }];

  it('accepts a template whose raw filters read the wall clock', () => {
    expect(validator.validateTemplate(card(clocky)).success).toBe(true);
  });

  it('warns that its renders will not be reproducible', () => {
    expect(validator.getMotionWarnings(card(clocky))).toContainEqual(
      expect.objectContaining({
        code: 'nondeterministic_expression',
        path: 'sections[0].filters[0].values.text.en',
        severity: 'warn',
      })
    );
  });
});

describe('schema: determinism fields', () => {
  const validator = new TemplateValidator();

  it('accepts a uint32 seed', () => {
    const descriptor = { ...card([]), global: { seed: 4294967295 } };
    expect(validator.validateTemplate(descriptor).success).toBe(true);
  });

  it('rejects an out-of-range seed', () => {
    expect(validator.validateTemplate({ ...card([]), global: { seed: -1 } }).success).toBe(false);
    expect(validator.validateTemplate({ ...card([]), global: { seed: 1.5 } }).success).toBe(false);
  });
});
