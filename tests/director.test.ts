import { ProjectConfig } from '@/core/types';
import { compile, loadConfig } from '../src';
import { main } from '@/main';

// Project Configuration
const projectConfig: ProjectConfig = {
  assetsDir: './src/shared/assets',
  currentLocale: 'en',
  audioConfig: {
    sampleRate: 44100,
    channelLayout: 'stereo',
  },
  videoConfig: {
    orientation: 'landscape',
    scale: '1280:720',
  },
  fields: {
    form_1_firstname: 'Firsname',
    form_1_lastname: 'Lastname',
    form_1_job: 'Tech Lead',
    form_2_keyword1: 'One',
    form_2_keyword2: 'Two',
    form_2_keyword3: 'Three',
  },
};

async function runTemplateCompilation(configName: string): Promise<boolean> {
  return await compile(projectConfig, await loadConfig(`./src/shared/templates/${configName}.json`));
}

describe('Segments', () => {
  it('should compile a picture section', async () => {
    expect(await runTemplateCompilation('picture')).toBe(true);
  }, 40000);

  it('should compile a video section from url successfully', async () => {
    expect(await runTemplateCompilation('video')).toBe(true);
  }, 40000);

  it('should compile an intertitle section with animation successfully', async () => {
    expect(await runTemplateCompilation('intertitle')).toBe(true);
  }, 40000);

  it('should compile a video section with a looped sound successfully', async () => {
    expect(await runTemplateCompilation('loop_music')).toBe(true);
  }, 40000);

  it('should compile a portrait video section', async () => {
    expect(await runTemplateCompilation('portrait')).toBe(true);
  }, 40000);

  it('should compile an accelerated video section', async () => {
    expect(await runTemplateCompilation('video_speed')).toBe(true);
  }, 40000);

  it('should compile a video with a local music', async () => {
    expect(await runTemplateCompilation('local_music')).toBe(true);
  }, 40000);

  it('should compile and concat background color sections', async () => {
    expect(await runTemplateCompilation('fast_and_curious')).toBe(true);
  }, 40000);
});

describe('Concat', () => {
  it('should concat several video sections with music mix', async () => {
    expect(await runTemplateCompilation('concat_videos_with_music')).toBe(true);
  }, 40000);
});

describe('Mixed Template', () => {
  it('should compile a mixed template successfully', async () => {
    expect(await main('sample.json')).toBe(true);
  }, 100000);
});
