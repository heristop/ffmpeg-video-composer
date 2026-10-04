import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_TEMPLATES } from '../../packages/leclap-creative-kit/src';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const registry = readFileSync(join(root, 'apps/leclap-expo/src/features/templates/template-posters.ts'), 'utf8');

describe('offline Expo sample posters', () => {
  it.each(APP_TEMPLATES)('bundles a rendered poster for $id', ({ id }) => {
    expect(registry).toContain(`template-previews/${id}.webp`);
    const bytes = readFileSync(join(root, `apps/leclap-expo/assets/template-previews/${id}.webp`));
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  });
});
