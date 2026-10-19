import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectJobs, loadFixtures } from '../../scripts/motion-review/lib/fixtures';
import { BACKGROUNDS, FORMATS, type ReviewOptions } from '../../scripts/motion-review/lib/types';
import { TemplateValidator } from '../../packages/ffmpeg-video-composer/src/services/TemplateValidator';

// The blend and motion-blur fixtures expand into valid descriptors on every background and format.
const dir = resolve(import.meta.dirname, '../../scripts/motion-review/fixtures');
const options: ReviewOptions = {
  out: '',
  label: 'test',
  assets: resolve(import.meta.dirname, '../../apps/leclap-web/public/assets'),
  effects: true,
  templates: false,
  only: [],
  formats: FORMATS,
  backgrounds: BACKGROUNDS,
  jobs: 1,
  build: false,
};

describe('motion-review composite fixtures', () => {
  it('validates layer-blend and motion-blur on every stage', () => {
    const fixtures = loadFixtures(dir).filter((fixture) => ['layer-blend', 'motion-blur'].includes(fixture.id));
    const jobs = effectJobs(fixtures, options);

    expect(fixtures.map((fixture) => fixture.id)).toEqual(['layer-blend', 'motion-blur']);
    expect(jobs).toHaveLength(18);

    for (const job of jobs) {
      expect(new TemplateValidator().validateTemplate(job.descriptor).errors ?? [], job.key).toEqual([]);
    }
  });
});
