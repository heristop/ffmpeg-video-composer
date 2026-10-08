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
    expect(Object.keys(html.recipes)).toEqual(['card', 'badge', 'priceTag', 'twoColumnStat']);
  });

  it.each(['card', 'badge', 'priceTag', 'twoColumnStat'] as const)(
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
});
