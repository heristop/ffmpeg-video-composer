import { readFile, writeFile } from 'node:fs/promises';
import { effectDocumentation } from './effect-docs.js';

const file = new URL('../../../docs/effects-configuration.md', import.meta.url);
const current = await readFile(file, 'utf8');
const catalog = JSON.parse(
  await readFile(new URL('../../../examples/llm-remotion-title/effect-catalog.json', import.meta.url), 'utf8')
);
const expected = effectDocumentation(current, catalog);

if (process.argv.includes('--check')) {
  if (current !== expected) throw new Error('Effect documentation is stale. Run pnpm docs:effects.');
}

if (!process.argv.includes('--check')) {
  await writeFile(file, expected);
}
