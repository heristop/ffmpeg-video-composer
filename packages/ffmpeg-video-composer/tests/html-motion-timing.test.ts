import { describe, expect, it } from 'vitest';
import { resolveMotionDescriptor } from '@/core/motion/tokens';
import { resolveTimeRefs } from '@/core/timing/resolve';

type Motion = Record<string, Record<string, unknown>>;

function descriptor(motion: Motion, global: Record<string, unknown> = {}) {
  return {
    global: { orientation: 'landscape', musicEnabled: false, ...global },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 4 },
        inputs: [{ name: 'list', type: 'html', html: '<p data-motion="item">A</p>', width: 300, height: 100, motion }],
      },
    ],
  };
}

function motionOf(resolved: { sections?: unknown }): Motion {
  return (resolved.sections as Array<{ inputs: Array<{ motion: Motion }> }>)[0].inputs[0].motion;
}

describe('html element motion tokens', () => {
  it('resolves duration and spring tokens in element tracks and keeps the stagger', () => {
    const resolved = resolveMotionDescriptor(
      descriptor({
        item: {
          y: [
            { t: 0, v: 24 },
            { t: '+$base', v: 0, ease: '$snappy' },
          ],
          stagger: 0.1,
        },
      })
    );

    expect(motionOf(resolved)).toEqual({
      item: {
        y: [
          { t: 0, v: 24 },
          { t: '+0.6', v: 0, ease: 'spring(420, 30, 1, 0)' },
        ],
        stagger: 0.1,
      },
    });
  });

  it('scales relative offsets by energy instead of reading the map as an entrance', () => {
    const resolved = resolveMotionDescriptor(
      descriptor(
        {
          item: {
            x: [
              { t: 0, v: '+40' },
              { t: 0.5, v: 0 },
            ],
          },
        },
        { motion: { energy: 1.5 } }
      )
    );

    expect(motionOf(resolved).item.x).toEqual([
      { t: 0, v: '+60' },
      { t: 0.5, v: 0 },
    ]);
  });

  it('treats element names as data, not as intents', () => {
    const track = [
      { t: 0, v: 0 },
      { t: '+$base', v: 1 },
    ];
    const resolved = resolveMotionDescriptor(
      descriptor({
        x: { opacity: track },
        scale: { opacity: track },
        opacity: { opacity: track },
        in: { opacity: track },
      })
    );

    for (const name of ['x', 'scale', 'opacity', 'in']) {
      expect(motionOf(resolved)[name].opacity).toEqual([
        { t: 0, v: 0 },
        { t: '+0.6', v: 1 },
      ]);
    }
  });
});

describe('html element motion time references', () => {
  it('resolves time references in element tracks to section seconds', () => {
    const { descriptor: resolved, issues } = resolveTimeRefs(
      descriptor({
        item: {
          opacity: [
            { t: '50%', v: 0 },
            { t: 'end - 1', v: 1 },
          ],
        },
      })
    );

    expect(issues).toEqual([]);
    expect(motionOf(resolved).item.opacity).toEqual([
      { t: 2, v: 0 },
      { t: 3, v: 1 },
    ]);
  });
});
