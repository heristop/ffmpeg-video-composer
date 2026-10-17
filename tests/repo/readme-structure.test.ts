import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');

describe('README structure', () => {
  // A reader decides in the first screenful. The demo has to beat the prose to it.
  it('shows the demo before the comparison', () => {
    const demo = readme.indexOf('## 🎥 Demo');
    const why = readme.indexOf('## 🤔 Why LeClap?');
    expect(demo, 'demo section missing').toBeGreaterThan(-1);
    expect(why, 'Why LeClap? section missing').toBeGreaterThan(-1);
    expect(demo).toBeLessThan(why);
  });

  // Asserting on the prose is vacuous: the intro already name-drops the alternatives. Assert on the table
  // itself, so deleting it turns this red. leclap.dev/compare/remotion links to this section's anchor.
  it('carries a comparison table naming the alternatives people already know', () => {
    const why = readme.indexOf('## 🤔 Why LeClap?');
    expect(why, 'Why LeClap? section missing').toBeGreaterThan(-1);

    const lines = readme.slice(why).split('\n');
    const headerIndex = lines.findIndex(
      (line) =>
        line.startsWith('|') && line.includes('Remotion') && line.includes('editly') && line.includes('fluent-ffmpeg')
    );
    expect(headerIndex, 'comparison table header row missing').toBeGreaterThan(-1);

    const columns = lines[headerIndex]
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    expect(columns, 'one column per alternative, plus the criterion column').toHaveLength(5);
    expect(columns.join(' '), 'LeClap needs its own column').toContain('LeClap');

    // a markdown table header is followed by its alignment separator
    expect(lines[headerIndex + 1], 'header row is not a table header').toMatch(/^\|[\s:|-]+\|$/);

    const rows: string[] = [];
    for (const line of lines.slice(headerIndex + 2)) {
      if (!line.startsWith('|')) break;
      rows.push(line);
    }
    expect(rows.length, 'the table has to actually compare something').toBeGreaterThanOrEqual(3);
  });

  // The film is a poster that links to the page playing it, so a newer cut only swaps one image and one link.
  // No GIFs anywhere in the README.
  it('links the film from a poster, with no GIF', () => {
    const demo = readme.slice(readme.indexOf('## 🎥 Demo'));
    expect(demo).toMatch(/<a href="https:\/\/leclap\.dev\/[^"]*"><img src="[^"]+\.webp"/);
    expect(readme).not.toMatch(/\.gif\b/i);
  });

  it('spells the brand LeClap everywhere', () => {
    expect(readme).not.toMatch(/\bLeclap\b|\bleClap\b|\bLECLAP\b/);
  });
});
