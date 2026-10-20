import { describe, expect, it } from 'vitest';
import { encodeTemplatePayload } from 'ffmpeg-video-composer/src/core/template-link/index.ts';
import { importTemplateLink } from './open-template-link';

const noUploads = { hasUpload: async () => false };

const bundled = import.meta.glob('../../../../../../packages/leclap-creative-kit/src/templates/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const showcase = import.meta.glob('../../../../public/videos/showcase/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

function usesPartials(template: unknown): boolean {
  return JSON.stringify(template).includes('"type":"partial"');
}

const cases = Object.entries({ ...bundled, ...showcase }).filter(([, template]) => usesPartials(template));

describe('opening a builder link for templates that use partials', () => {
  it('covers the bundled and showcase templates that use partials', () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });

  it.each(cases)('opens %s from a link', async (_file, template) => {
    const result = await importTemplateLink(`#t=${await encodeTemplatePayload(template)}`, noUploads);

    expect(result).toMatchObject({ kind: 'opened' });
  });
});
