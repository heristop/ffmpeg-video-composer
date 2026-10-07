import { describe, expect, it } from 'vitest';
import type { RenderManifest } from 'ffmpeg-video-composer';
import { checkOutput, compareRenders, firstGraphDifference } from '../src/verify-checks';

function manifest(overrides: Partial<{ output: string; graph: string; commands: string[] }> = {}): RenderManifest {
  return {
    schemaVersion: 1,
    engine: { name: 'ffmpeg-video-composer', version: '2.5.0' },
    ffmpeg: { version: '8.1.1' },
    deterministic: true,
    template: { sha256: 'aaaa', seed: 0, descriptor: {} },
    config: {},
    assets: [{ path: '$ASSETS/fonts/Oswald.ttf', sha256: 'ffff' }],
    graph: { sha256: overrides.graph ?? 'gggg', commands: overrides.commands ?? ['-i a $BUILD/o.mp4'] },
    output: { sha256: overrides.output ?? 'oooo', bytes: 10 },
  };
}

describe('verify checks', () => {
  it('matches a file against the recorded output digest', () => {
    expect(checkOutput(manifest(), { sha256: 'oooo' }).ok).toBe(true);
    expect(checkOutput(manifest(), { sha256: 'xxxx' }).ok).toBe(false);
    expect(checkOutput(manifest(), null).ok).toBe(false);
  });

  it('compares a fresh render digest by digest', () => {
    const checks = compareRenders(manifest(), manifest({ graph: 'hhhh', commands: ['-i b $BUILD/o.mp4'] }));

    expect(checks.map((check) => [check.check, check.ok])).toEqual([
      ['template', true],
      ['assets', true],
      ['graph', false],
      ['output', true],
    ]);
  });

  it('points at the first command that changed', () => {
    const diff = firstGraphDifference(manifest(), manifest({ commands: ['-i b $BUILD/o.mp4'] }));

    expect(diff).toBe('- -i a $BUILD/o.mp4\n+ -i b $BUILD/o.mp4');
    expect(firstGraphDifference(manifest(), manifest())).toBeNull();
  });
});
