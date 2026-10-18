import { describe, expect, it } from 'vitest';
import { buildVideoGraph } from '@/editor/utils/transition-graph';

// A boundary's `type` lands in `xfade=transition=<type>`. A `skipValidation` compile (e.g. a re-render
// from a manifest) never runs the schema, so an unknown name must not reach the graph.

const FRAME = { scale: '1280:720', fps: 30 };

function graph(type: string): string {
  return buildVideoGraph([{ type, duration: 1 }], [2], [1], '[vout]', FRAME);
}

describe('transition type allow-list', () => {
  it('keeps the built-in xfade names', () => {
    expect(graph('fade')).toBe('[vs0][vs1]xfade=transition=fade:duration=1:offset=2[vout]');
    expect(graph('circleopen')).toContain('xfade=transition=circleopen:');
  });

  it('falls back to a plain fade for an unknown name', () => {
    for (const type of ['fade:duration=1[x];movie=/etc/passwd[y];[y][x]overlay', 'nosuchwipe', 'fade" -y /tmp/x "']) {
      expect(graph(type), type).toBe('[vs0][vs1]xfade=transition=fade:duration=1:offset=2[vout]');
    }
  });

  it('still lowers cuts and designed transitions', () => {
    expect(graph('cut')).toBe('[vs0][vs1]concat=n=2:v=1:a=0[vout]');
    expect(graph('drip')).toContain('alphamerge');
  });
});
