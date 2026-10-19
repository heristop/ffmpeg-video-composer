// packages/ffmpeg-video-composer/tests/html-motion-sample.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import { TemplateValidator } from '@/services/TemplateValidator';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = testBuildDir('html-motion-sample');
const sample = path.resolve(here, '../../../examples/motion-design/html-motion.json');

afterAll(() => {
  fs.rmSync(buildDir, { recursive: true, force: true });
});

describe('html-motion sample', () => {
  const descriptor = JSON.parse(fs.readFileSync(sample, 'utf8')) as TemplateDescriptor;

  it('validates with no html advisory', () => {
    const validator = new TemplateValidator();

    expect(validator.validateTemplate(descriptor).errors ?? []).toEqual([]);
    expect(validator.getMotionWarnings(descriptor).filter((warning) => warning.code.startsWith('html_'))).toEqual([]);
  });

  it('stages each card as an animated PNG', async () => {
    const config = {
      buildDir,
      assetsDir: path.resolve(here, '../../leclap-creative-kit/src/library'),
      currentLocale: 'en',
      audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
      videoConfig: { orientation: 'landscape', scale: '1280:720' },
      fields: {},
      userVideoPaths: {},
    } as unknown as ProjectConfig;

    expect(await compile(config, descriptor)).not.toBeNull();
    expect(fs.readdirSync(path.join(buildDir, 'panels')).filter((file) => file.endsWith('.apng'))).toHaveLength(2);
  }, 120_000);
});
