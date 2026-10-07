import { describe, expect, it } from 'vitest';
import { resolveReport } from '../src/commands/resolve';
import { KNOWN_COMMANDS } from '../src/args';

const template = {
  global: { fields: { HOLD: { type: 'number', default: 3 }, TITLE: { type: 'text', required: true } } },
  sections: [
    {
      name: 'card',
      type: 'color_background',
      options: { backgroundColor: '#101014', duration: '{{ HOLD }}' },
      filters: [{ type: 'drawtext', values: { text: { en: '{{ TITLE }}' } } }],
    },
  ],
};

describe('leclap resolve', () => {
  it('is a known subcommand', () => {
    expect(KNOWN_COMMANDS).toContain('resolve');
  });

  it('prints the descriptor filled with the --set values', () => {
    const report = resolveReport(template, ['TITLE=Hi', 'HOLD=4']);
    const descriptor = JSON.parse(report.stdout) as { sections: Array<{ options: { duration: unknown } }> };

    expect(report.ok).toBe(true);
    expect(descriptor.sections[0].options.duration).toBe(4);
    expect(report.stderr).toEqual([]);
  });

  it('fails with one line per problem a render would refuse', () => {
    const report = resolveReport(template, ['HOLD=slow']);

    expect(report.ok).toBe(false);
    expect(report.stderr.join('\n')).toContain('HOLD');
    expect(report.stderr.join('\n')).toContain('TITLE');
  });
});
