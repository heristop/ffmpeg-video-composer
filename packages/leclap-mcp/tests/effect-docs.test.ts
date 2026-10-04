import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectDocumentation, effectContractMarkdown } from '../scripts/effect-docs.js';
import { listEffectDefinitions } from '../src/effects/effect-catalog.js';
import { parseCustomEffectCatalog } from '../src/effects/custom-effect-catalog.js';

const catalog = JSON.parse(
  readFileSync(new URL('../../../examples/llm-remotion-title/effect-catalog.json', import.meta.url), 'utf8')
);
const current = readFileSync(new URL('../../../docs/effects-configuration.md', import.meta.url), 'utf8');

describe('published effect reference', () => {
  it('matches every current built-in and example contract including defaults, bounds and asset policies', () => {
    expect(current).toBe(effectDocumentation(current, catalog));
    for (const definition of listEffectDefinitions(parseCustomEffectCatalog(catalog))) {
      expect(current).toContain(`${definition.id}@${definition.version}`);
      expect(current).toContain(definition.compositionId);
    }
  });
  it('documents optional custom assets and required props without conflating defaults with required input', () => {
    const docs = effectContractMarkdown({
      schemaVersion: 1,
      effects: [
        {
          id: 'studio.test',
          version: '1.0.0',
          compositionId: 'CustomTest',
          propsSchema: {
            type: 'object',
            properties: {
              requiredCopy: { type: 'string', minLength: 1 },
              count: { type: 'integer', minimum: 1, maximum: 3, default: 2 },
            },
            required: ['requiredCopy'],
            additionalProperties: false,
          },
          assets: { optionalLogo: { extensions: ['.png'], required: false } },
        },
      ],
    });
    expect(docs).toContain('| `requiredCopy` | string | yes |');
    expect(docs).toContain('| `count` | integer | no | ≥ 1; ≤ 3 | 2 |');
    expect(docs).toContain('| `optionalLogo` | no | .png |');
  });
});
