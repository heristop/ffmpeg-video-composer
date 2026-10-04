import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';

const library = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../leclap-creative-kit/src');

describe('app promo sample contracts', () => {
  for (const id of ['product-launch', 'web-app-promo', 'app-tutorial', 'square-promo', 'story-reel']) {
    it(`${id} fits the longest allowed form copy with bundled fonts`, async () => {
      const raw = JSON.parse(fs.readFileSync(path.join(library, 'templates', `${id}.json`), 'utf8'));
      const validator = new TemplateValidator();
      const validated = validator.validateTemplate(raw);
      expect(validated.success, JSON.stringify(validated.errors)).toBe(true);
      let source = JSON.stringify(raw);
      for (const field of raw.sections[0].options.fields) {
        source = source.split(`{{ ${field.name} }}`).join('W'.repeat(field.maxLength));
      }
      const warnings = await validator.getGeometryWarnings(JSON.parse(source), async (font) => {
        return new Uint8Array(fs.readFileSync(path.join(library, 'library/fonts', font)));
      });
      expect(
        warnings.filter((warning) => ['text_out_of_frame', 'text_collision', 'text_too_small'].includes(warning.code))
      ).toEqual([]);
    });
  }
});
