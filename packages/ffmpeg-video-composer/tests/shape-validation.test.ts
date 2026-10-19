import { describe, expect, it } from 'vitest';
import type { TemplateDescriptor } from '@/core/types';
import { TemplateValidator } from '@/services/TemplateValidator';

function findings(graphic: Record<string, unknown>): string[][] {
  const descriptor = {
    global: { orientation: 'landscape', musicEnabled: false },
    sections: [
      {
        name: 's',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 3 },
        graphics: [{ type: 'shape', preset: { type: 'star' }, ...graphic }],
      },
    ],
  } as unknown as TemplateDescriptor;

  return (new TemplateValidator().validateTemplate(descriptor).errors ?? []).map((e) => [e.code, e.path, e.message]);
}

describe('shape graphic: track validation', () => {
  it('accepts layer tracks, springs and an origin on a shape', () => {
    expect(
      findings({
        origin: 'bottom',
        animate: {
          scale: [{ v: 0 }, { t: 0.6, v: 1, ease: 'spring(300, 14)' }],
          rotate: [{ v: -30 }, { t: 0.6, v: 0 }],
          x: [{ v: '-80' }, { t: 0.4, v: '+0' }],
        },
      })
    ).toEqual([]);
  });

  it('reports keys out of order at the shape track path', () => {
    expect(
      findings({
        animate: {
          scale: [
            { t: 1, v: 0 },
            { t: 0.5, v: 1 },
          ],
        },
      })
    ).toEqual([['invalid_keyframes', 'sections[0].graphics[0].animate.scale', 'key 1 (t=0.5) is not after key 0']]);
  });

  it('reports values out of range and relative values where they mean nothing', () => {
    expect(findings({ animate: { opacity: [{ v: 0 }, { t: 1, v: 1.5 }] } })).toEqual([
      [
        'invalid_keyframes',
        'sections[0].graphics[0].animate.opacity',
        'opacity keys take values from 0 to 1 (got 1.5)',
      ],
    ]);
    expect(findings({ animate: { scale: [{ v: '+1' }] } })).toEqual([
      [
        'invalid_keyframes',
        'sections[0].graphics[0].animate.scale',
        'scale keys take plain numbers, not relative offsets',
      ],
    ]);
  });

  it('reports a bad time string at the shape track axis', () => {
    expect(findings({ animate: { x: [{ v: 0 }, { t: 'soon', v: 1 }] } })).toEqual([
      [
        'invalid_keyframes',
        'sections[0].graphics[0].animate.x',
        'time "soon" is not seconds, "+seconds", a duration token or a time reference',
      ],
    ]);
  });

  it('still refuses animate on a filter that is neither a shape nor drawtext', () => {
    const descriptor = {
      global: { orientation: 'landscape', musicEnabled: false },
      sections: [
        {
          name: 's',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 3 },
          filters: [{ type: 'scale', animate: { x: [{ v: 0 }, { t: 1, v: 1 }] } }],
        },
      ],
    } as unknown as TemplateDescriptor;
    const errors = new TemplateValidator().validateTemplate(descriptor).errors ?? [];

    expect(errors.map((e) => [e.path, e.message])).toContainEqual([
      'sections[0].filters[0].animate',
      'animate tracks apply to drawtext filters',
    ]);
  });
});
