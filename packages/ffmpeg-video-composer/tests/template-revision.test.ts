import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { templateRevision } from '@/core/determinism';
import { listSamples, getSample } from '@/samples';

// The reference implementation @leclap/mcp shipped before revisions moved into the engine.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => {
          if (a === b) return 0;

          return a < b ? -1 : 1;
        })
        .map(([key, item]) => [key, canonical(item)])
    );
  }

  return value;
}

function nodeRevision(template: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(template)))
    .digest('hex');
}

const FIXTURES: Record<string, unknown>[] = [
  {},
  { a: 1, b: { x: 2, y: [3, { z: null, a: true }] } },
  { '10': 'ten', '2': 'two', b: 'bee', A: 'upper', _: 'under' },
  { text: 'Café ✨ 日本語 🎬 \u0000 "quoted" \\ back\nslash' },
  { lone: 'high \uD83D only', low: '\uDE00 low', pair: '🎬' },
  { n: [0, -0, 1.5, 1e21, -3e-7], skipped: undefined, list: [undefined, 1] },
];

describe('templateRevision', () => {
  it('ignores object key ordering', () => {
    expect(templateRevision({ a: 1, b: { x: 2, y: 3 } })).toBe(templateRevision({ b: { y: 3, x: 2 }, a: 1 }));
    expect(templateRevision({ a: 1 })).not.toBe(templateRevision({ a: 2 }));
  });

  it('matches a node:crypto digest of the same canonical JSON', () => {
    for (const fixture of FIXTURES) expect(templateRevision(fixture)).toBe(nodeRevision(fixture));
  });

  it('matches node:crypto for every bundled sample', () => {
    const samples = listSamples();

    expect(samples.length).toBeGreaterThan(0);

    for (const { id } of samples) {
      const template = getSample(id).template as Record<string, unknown>;
      expect(templateRevision(template)).toBe(nodeRevision(template));
    }
  });
});
