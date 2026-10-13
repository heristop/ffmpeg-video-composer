import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The browser entry leaves the template validator (and the overlay lowering it runs) out of its eager load:
// `Template` validates synchronously once `loadTemplateValidation()` (or a first compile) has loaded it.
describe('browser entry template validation', () => {
  it('loads the validator on demand, then validates synchronously', async () => {
    const { Template, loadTemplateValidation } = await import('@/browser');
    const json = await readFile(path.join(__dirname, 'fixtures/picture.json'), 'utf-8');
    const template = new Template();

    expect(() => template.loadFromJSON(json)).toThrow(/loadTemplateValidation/);
    expect(() => template.setDescriptor({})).toThrow(/loadTemplateValidation/);

    await loadTemplateValidation();

    expect(template.loadFromJSON(json).success).toBe(true);
    expect(template.validateDescriptor().success).toBe(true);
    expect(template.setDescriptor({ global: { orientation: 'sideways' } }).success).toBe(false);
  });

  it('resolves template effects through the lazily loaded validator', async () => {
    const { resolveTemplateEffects } = await import('@/browser');
    const descriptor = { global: { orientation: 'landscape' }, sections: [] };

    await expect(resolveTemplateEffects(descriptor, () => Promise.reject(new Error('unused')))).resolves.toMatchObject({
      descriptor: { sections: [] },
    });
    await expect(
      resolveTemplateEffects({ global: { orientation: 'sideways' } }, () => Promise.reject(new Error('unused')))
    ).rejects.toThrow();
  });
});
