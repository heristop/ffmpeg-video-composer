import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCustomEffectCatalog } from '../src/effects/custom-effect-catalog.js';
import { getEffectDefinition } from '../src/effects/effect-catalog.js';
import { TemplateValidator } from 'ffmpeg-video-composer';

const example = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/llm-remotion-title');

describe('JSON Remotion title reference project', () => {
  it('provides valid effect authoring JSON followed by an ordinary engine section', async () => {
    const template = JSON.parse(await fs.readFile(path.join(example, 'template.json'), 'utf8'));
    const result = new TemplateValidator().validateTemplate(template);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    expect(template.sections[0].effect.id).toBe('leclap.title-reveal');
    expect(template.sections[1].type).toBe('color_background');
  });
});

it('registers a third asset-free generic composition matching the catalog and template', async () => {
  const catalog = loadCustomEffectCatalog(path.join(example, 'effect-catalog.json'));
  const template = JSON.parse(await fs.readFile(path.join(example, 'custom-template.json'), 'utf8'));
  expect(new TemplateValidator().validateTemplate(template).success).toBe(true);
  const effect = template.sections[0].effect;
  const definition = getEffectDefinition(effect.id, effect.version, catalog);
  expect(definition.compositionId).toBe('LeclapProductReveal');
  expect(definition.props.parse(effect.props)).toEqual(effect.props);
  expect(definition.assets.parse(effect.assets)).toEqual({});
  const root = await fs.readFile(path.join(example, 'remotion/Root.tsx'), 'utf8');
  expect(root.match(/<Composition/g)).toHaveLength(4);
  expect(root).toContain('id="LeclapProductReveal"');
  const source = await fs.readFile(path.join(example, 'remotion/ProductReveal.tsx'), 'utf8');
  expect(source).toContain('useCurrentFrame');
  expect(source).toContain('spring(');
  expect(source).not.toMatch(/brand-motion-kit|@keyframes|animation:/);
});
