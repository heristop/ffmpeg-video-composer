import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { htmlOverflowWarnings } from '@/services/html-node/html-overflow-node';
import type { TemplateDescriptor } from '@/schemas/template.schemas';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(here, '../../leclap-creative-kit/src/library/fonts');

async function loadFont(file: string): Promise<Uint8Array | null> {
  return new Uint8Array(fs.readFileSync(path.join(fontsDir, file)));
}

function template(html: string, height: number): TemplateDescriptor {
  return {
    global: { variables: { city: 'Lyon' } },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { duration: 2 },
        inputs: [{ name: 'card', type: 'html', html, css: 'p { margin: 0; font-size: 40px }', width: 300, height }],
      },
    ],
  } as unknown as TemplateDescriptor;
}

describe('html_overflow', () => {
  it('says nothing when the content fits its box', async () => {
    expect(await htmlOverflowWarnings(template('<p>{{ city }}</p>', 200), loadFont)).toEqual([]);
  });

  it('measures a div that holds only text', async () => {
    expect(await htmlOverflowWarnings(template('<div>Shop the collection</div>', 200), loadFont)).toEqual([]);
  }, 30_000);

  it('measures content taller than its box', async () => {
    const warnings = await htmlOverflowWarnings(template('<p>one</p><p>two</p><p>three</p>', 60), loadFont);

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'html_overflow',
        path: 'sections[0].inputs[0].height',
        severity: 'warn',
        approx: false,
        message: expect.stringMatching(/\d+ px tall in its 60 px box/),
      }),
    ]);
  }, 30_000);
});
