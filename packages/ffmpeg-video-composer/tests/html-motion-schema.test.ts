import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/core/html/html-parse';
import { sanitiseHtml } from '@/core/html/html-sanitise';
import { HtmlMotionSchema } from '@/schemas/html-motion.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';
import type { TemplateDescriptor } from '@/schemas/template.schemas';

function template(input: Record<string, unknown>): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', musicEnabled: false },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 2 },
        inputs: [input],
      },
    ],
  } as unknown as TemplateDescriptor;
}

const errors = (descriptor: TemplateDescriptor) => new TemplateValidator().validateTemplate(descriptor).errors ?? [];

describe('HtmlMotionSchema', () => {
  it('takes element tracks and a stagger per motion name', () => {
    const motion = {
      item: {
        opacity: [
          { t: 0, v: 0 },
          { t: 0.4, v: 1 },
        ],
        y: [
          { t: 0, v: '+24' },
          { t: 0.4, v: 0, ease: '$snappy' },
        ],
        stagger: 0.12,
      },
    };

    expect(HtmlMotionSchema.safeParse(motion).success).toBe(true);
  });

  it('refuses names the markup cannot carry, unknown tracks and long staggers', () => {
    expect(HtmlMotionSchema.safeParse({ Title: { opacity: [{ v: 1 }] } }).success).toBe(false);
    expect(HtmlMotionSchema.safeParse({ title: { scaleX: [{ v: 1 }] } }).success).toBe(false);
    expect(HtmlMotionSchema.safeParse({ title: { stagger: 3 } }).success).toBe(false);
  });

  it('refuses the names descriptor walkers key on', () => {
    for (const name of ['ease', 'easing', 'animate']) {
      const result = HtmlMotionSchema.safeParse({ [name]: { opacity: [{ v: 1 }] } });

      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain('and not ease, easing or animate');
    }
  });

  it('caps the names of one layer at 16', () => {
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`n${i}`, { opacity: [{ v: 1 }] }]));

    expect(HtmlMotionSchema.safeParse(many).success).toBe(false);
  });
});

describe('data-motion in the sanitiser', () => {
  it('keeps a valid name', () => {
    const { nodes, findings } = sanitiseHtml(parseHtml('<p data-motion="item">A</p>'));

    expect(findings).toEqual([]);
    expect(nodes).toEqual(parseHtml('<p data-motion="item">A</p>'));
  });

  it('drops a reserved name with a finding', () => {
    const { nodes, findings } = sanitiseHtml(parseHtml('<p data-motion="animate">A</p>'));

    expect(nodes).toEqual(parseHtml('<p>A</p>'));
    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('data-motion')]);
  });
});

describe('html input motion', () => {
  it('validates on an html input', () => {
    const input = {
      name: 'list',
      type: 'html',
      html: '<p data-motion="item">A</p>',
      width: 300,
      height: 100,
      motion: {
        item: {
          opacity: [
            { t: 0, v: 0 },
            { t: 0.4, v: 1 },
          ],
        },
      },
    };

    expect(errors(template(input))).toEqual([]);
  });

  it('belongs to html inputs only', () => {
    const input = { name: 'logo', type: 'image', url: 'a.png', motion: { a: { opacity: [{ v: 1 }] } } };

    expect(errors(template(input)).map((error) => [error.path, error.message])).toEqual([
      ['sections.0.inputs.0.motion', '"motion" belongs to an html input (type: "html")'],
    ]);
  });
});
