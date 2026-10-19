import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectJobs, loadFixtures } from '../../scripts/motion-review/lib/fixtures';
import type { TemplateDescriptor } from '../../packages/ffmpeg-video-composer/src/core/types';
import { TemplateValidator } from '../../packages/ffmpeg-video-composer/src/services/TemplateValidator';

// The shape graphic's motion-review fixtures, laid on the stage exactly as `pnpm motion:review` lays them,
// validate in every format (the card backgrounds; footage only swaps the base section).

const FIXTURES = path.resolve(import.meta.dirname, '../../scripts/motion-review/fixtures');
const fixtures = loadFixtures(FIXTURES).filter((fixture) => fixture.id.startsWith('shape-'));
const jobs = effectJobs(fixtures, {
  out: '',
  label: 'after',
  assets: path.resolve(import.meta.dirname, '../../apps/leclap-web/public/assets'),
  effects: true,
  templates: false,
  only: [],
  formats: ['landscape', 'portrait', 'square'],
  backgrounds: ['dark', 'light'],
  jobs: 1,
  build: false,
});

describe('shape motion-review fixtures', () => {
  it('covers the pop, the draw-on and the gradient blob', () => {
    expect(fixtures.map((fixture) => fixture.id).sort()).toEqual([
      'shape-blob-gradient',
      'shape-draw-on',
      'shape-star-pop',
    ]);
  });

  it('validates on every background and format', () => {
    expect(jobs).toHaveLength(18);

    for (const job of jobs) {
      const result = new TemplateValidator().validateTemplate(job.descriptor as unknown as TemplateDescriptor);

      expect(result.errors ?? [], job.key).toEqual([]);
    }
  });
});
