import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectJobs, loadFixtures } from '../../scripts/motion-review/lib/fixtures';
import type { TemplateDescriptor } from '../../packages/ffmpeg-video-composer/src/core/types';
import { TemplateValidator } from '../../packages/ffmpeg-video-composer/src/services/TemplateValidator';

// The mask fixtures, laid on the stage exactly as `pnpm motion:review` lays them, validate on every background
// and format they list, so a review run never shows a validation failure instead of the mask.

const FIXTURES = path.resolve(import.meta.dirname, '../../scripts/motion-review/fixtures');
const fixtures = loadFixtures(FIXTURES).filter((fixture) => fixture.id.startsWith('mask-'));
const jobs = effectJobs(fixtures, {
  out: '',
  label: 'after',
  assets: path.resolve(import.meta.dirname, '../../apps/leclap-web/public/assets'),
  effects: true,
  templates: false,
  only: [],
  formats: ['landscape', 'portrait', 'square'],
  backgrounds: ['footage', 'dark', 'light'],
  jobs: 1,
  build: false,
});

describe('mask motion-review fixtures', () => {
  it('covers the iris, the star hole and the text matte', () => {
    expect(fixtures.map((fixture) => fixture.id)).toEqual(['mask-iris', 'mask-star-hole', 'mask-text-matte']);
  });

  it('validates on every background and format', () => {
    // iris: footage+dark x 3, star hole: 3 backgrounds x 3, text matte: footage x 3
    expect(jobs).toHaveLength(6 + 9 + 3);

    for (const job of jobs) {
      const result = new TemplateValidator().validateTemplate(job.descriptor as unknown as TemplateDescriptor);

      expect(result.errors ?? [], job.key).toEqual([]);
    }
  });
});
