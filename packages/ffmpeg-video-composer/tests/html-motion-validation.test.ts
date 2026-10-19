import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import type { TemplateDescriptor } from '@/schemas/template.schemas';

function template(input: Record<string, unknown>, global: Record<string, unknown> = {}): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', musicEnabled: false, ...global },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 4 },
        inputs: [input],
      },
    ],
  } as unknown as TemplateDescriptor;
}

const LIST = {
  name: 'list',
  type: 'html',
  html: '<ul><li data-motion="item">One</li><li data-motion="item">Two</li></ul>',
  width: 400,
  height: 160,
};
const FADE = {
  opacity: [
    { t: 0.2, v: 0 },
    { t: 0.6, v: 1, ease: 'ease-out' },
  ],
};
const validator = new TemplateValidator();
const errors = (descriptor: TemplateDescriptor) => validator.validateTemplate(descriptor).errors ?? [];
const advisories = (descriptor: TemplateDescriptor) =>
  validator.getMotionWarnings(descriptor).filter((warning) => warning.code.startsWith('html_'));

describe('html element motion validation', () => {
  it('accepts a staggered list with no html advisory', () => {
    const descriptor = template({ ...LIST, motion: { item: { ...FADE, stagger: 0.15 } } });

    expect(errors(descriptor)).toEqual([]);
    expect(advisories(descriptor)).toEqual([]);
  });

  it('checks element tracks like layer tracks', () => {
    const motion = {
      item: {
        opacity: [
          { t: 0, v: 0 },
          { t: 0.5, v: 1.5 },
        ],
        x: [
          { t: 1, v: 0 },
          { t: 0.5, v: 10 },
        ],
      },
    };

    expect(
      errors(template({ ...LIST, motion }))
        .map((error) => [error.code, error.path])
        .sort(([, a], [, b]) => a.localeCompare(b))
    ).toEqual([
      ['invalid_keyframes', 'sections[0].inputs[0].motion.item.opacity'],
      ['invalid_keyframes', 'sections[0].inputs[0].motion.item.x'],
    ]);
  });

  it('refuses motion over the frame budget, naming the count and the limit', () => {
    const motion = {
      item: {
        x: [
          { t: 0, v: 0 },
          { t: 7.9, v: 790 },
        ],
      },
    };

    expect(errors(template({ ...LIST, motion }, { fps: 60 }))).toEqual([
      expect.objectContaining({
        code: 'html_motion_too_long',
        path: 'sections[0].inputs[0].motion',
        message: 'html layer motion is over budget for input "list": 475 distinct frames (limit 240)',
      }),
    ]);
  });

  it('refuses a stagger that stretches the motion past the span limit', () => {
    const items = Array.from({ length: 12 }, (_, i) => `<li data-motion="item">${i}</li>`).join('');
    const descriptor = template({
      ...LIST,
      html: `<ul>${items}</ul>`,
      motion: {
        item: {
          opacity: [
            { t: 0, v: 0 },
            { t: 0.4, v: 1 },
          ],
          stagger: 0.8,
        },
      },
    });

    expect(errors(descriptor).map((error) => [error.code, error.message])).toEqual([
      [
        'html_motion_too_long',
        'html layer motion is over budget for input "list": an animated span of 9.2 s (limit 8 s)',
      ],
    ]);
  });

  it('refuses more tagged elements than a card moves', () => {
    const items = Array.from({ length: 49 }, (_, i) => `<li data-motion="item">${i}</li>`).join('');
    const descriptor = template({ ...LIST, html: `<ul>${items}</ul>`, height: 1900, motion: { item: FADE } });

    expect(errors(descriptor).map((error) => [error.code, error.path, error.message])).toEqual([
      [
        'html_motion_too_many_targets',
        'sections[0].inputs[0].html',
        'html layer motion: input "list" has 49 elements carrying data-motion (limit 48)',
      ],
    ]);
  });

  it('warns when a motion name matches no element, naming the tagged ones', () => {
    const descriptor = template({ ...LIST, motion: { itme: FADE } });

    expect(errors(descriptor)).toEqual([]);
    expect(advisories(descriptor)).toEqual([
      expect.objectContaining({
        code: 'html_motion_unmatched',
        path: 'sections[0].inputs[0].motion.itme',
        message: 'html layer: no element carries data-motion="itme", its tracks move nothing',
        hint: 'Tag the elements to move with data-motion="itme" (tagged here: item).',
      }),
    ]);
  });
});
