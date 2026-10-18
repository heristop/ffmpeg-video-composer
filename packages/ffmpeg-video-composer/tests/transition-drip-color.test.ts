import { describe, expect, it } from 'vitest';
import { designedTransitionGraph } from '@/core/motion/transitions';
import { dripGraph } from '@/core/motion/transition-drip';
import { boundaryTransitions } from '@/director/prepare-build';
import { TransitionSchema } from '@/schemas/effects.schemas';
import type { Section } from '@/core/types';

// The drip's paint colour reaches a filtergraph `color` source, so it must only ever be a colour: the
// schema accepts "#rrggbb" or a "$color.<name>" token, and the lowering falls back to the default paint
// for anything else (a `skipValidation` compile does not run the schema).

const HOSTILE = ['red:s=2x2[x];[x]nullsink;movie=/etc/passwd', 'red" -y /tmp/x "', 'rgb(1,2,3)', "white'[x]"];

const BOUNDARY = {
  type: 'drip' as const,
  left: 'vs0',
  right: 'vs1',
  out: 'v0',
  id: 'dt0',
  offset: 2,
  duration: 1,
  width: 1280,
  height: 720,
  fps: 30,
};

describe('drip colour: schema', () => {
  it('rejects anything but a #rrggbb colour or a $color token', () => {
    for (const color of HOSTILE) {
      expect(TransitionSchema.safeParse({ type: 'drip', color }).success, color).toBe(false);
    }
  });

  it('accepts a hex colour and theme tokens', () => {
    for (const color of ['#F96F99', '#f96f99', '$color.accent', '$color.accent2']) {
      expect(TransitionSchema.safeParse({ type: 'drip', color }).success, color).toBe(true);
    }
  });
});

describe('drip colour: lowering', () => {
  it('never lets a hostile colour into the graph', () => {
    for (const color of HOSTILE) {
      const graph = dripGraph({ ...BOUNDARY, tail: 't', in: 'i', mix: 'm', color, seed: 1 });

      expect(graph, color).toContain('color=c=0x9298FB:s=1280x720');
      expect(graph, color).not.toMatch(/movie|nullsink|passwd|"|'\[|rgb\(/);
    }
  });

  it('keeps hex colours, as 0xRRGGBB', () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, color: '#f96f99' });

    expect(graph).toContain('color=c=0xF96F99:s=1280x720');
  });

  it('never lets a hostile iris rim into the graph', () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, type: 'iris', rim: '#123456[x];movie=/etc/passwd' });

    expect(graph).not.toMatch(/movie|passwd/);
  });
});

describe('drip colour: boundary', () => {
  it('a section drip without a colour takes the global drip colour before the theme accent', () => {
    const sections = [{ name: 'a', transition: { type: 'drip', duration: 1 } }, { name: 'b' }] as unknown as Section[];
    const [boundary] = boundaryTransitions(sections, { type: 'drip', color: '#123456' }, true, {
      colors: { accent: '#9298FB' },
    });

    expect(boundary.color).toBe('#123456');
  });

  it('the section colour still wins over the global one', () => {
    const sections = [
      { name: 'a', transition: { type: 'drip', color: '#ABCDEF' } },
      { name: 'b' },
    ] as unknown as Section[];
    const [boundary] = boundaryTransitions(sections, { type: 'drip', color: '#123456' });

    expect(boundary.color).toBe('#ABCDEF');
  });
});
