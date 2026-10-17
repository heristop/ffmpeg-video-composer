import { describe, expect, it } from 'vitest';
import { motionCatalog } from '@/core/motion/catalog';
import { TemplateValidator } from '@/services/TemplateValidator';
import type { TemplateDescriptor } from '@/schemas/template.schemas';
import { HTML_CSS_PROPERTIES } from '@/core/html/css-properties';

describe('motionCatalog().html', () => {
  const { html } = motionCatalog();

  it('lists the supported subset the engine enforces', () => {
    expect(html.css).toEqual(HTML_CSS_PROPERTIES);
    expect(html.tags).toContain('strong');
    expect(html.attributes).toContain('data-motion');
    expect(Object.keys(html.recipes)).toEqual(['card', 'badge', 'priceTag', 'twoColumnStat', 'staggeredList']);
  });

  it.each(['card', 'badge', 'priceTag', 'twoColumnStat', 'staggeredList'] as const)(
    'recipe %s validates with no html advisory',
    (name) => {
      const descriptor = {
        global: { orientation: 'landscape', musicEnabled: false, fields: html.recipes[name].fields },
        sections: [
          {
            name: 'card',
            type: 'color_background',
            options: { backgroundColor: '#000000', duration: 2 },
            inputs: [html.recipes[name].input],
          },
        ],
      } as unknown as TemplateDescriptor;
      const validator = new TemplateValidator();

      expect(validator.validateTemplate(descriptor).errors ?? []).toEqual([]);
      expect(validator.getMotionWarnings(descriptor).filter((warning) => warning.code.startsWith('html_'))).toEqual([]);
    }
  );

  it('teaches per-element motion and its budget', () => {
    expect(html.shape).toContain('motion?');
    expect(html.motion).toContain('data-motion');
    expect(html.motion).toContain('stagger');
    expect(html.motion).toContain('html_motion_too_long');
    expect(html.motion).toContain('html_motion_too_many_targets');
    expect(html.recipes.staggeredList.input).toHaveProperty('motion.item.stagger', 0.15);
  });
});
