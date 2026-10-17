import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { compile } from '@/index';
import { planSubtitles } from '@/core/captions/plan';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { Subtitles } from '@/schemas/subtitles.schemas';
import { testBuildDir } from './fixtures/build-dir';

const execFileAsync = promisify(execFile);

// Real compile of HTML captions (subtitles.renderer "html"): every caption look rasterised once, played as
// one concat image stream and overlaid on the frame, the spoken word lit on the frames drawtext would light it.
const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, '../../leclap-creative-kit/src/library');
const buildDir = testBuildDir('subtitles-html-render');

const SUBTITLES: Subtitles = {
  words: [
    { text: 'Every', start: 0.3, end: 0.8 },
    { text: 'word', start: 1.2, end: 1.7 },
  ],
  style: 'boxed',
  karaoke: 'word',
  renderer: 'html',
};

async function averageRgb(filePath: string, atSeconds: number, crop: string): Promise<number[]> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-ss',
      String(atSeconds),
      '-i',
      filePath,
      '-vf',
      `crop=${crop},scale=1:1`,
      '-vframes',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 }
  );
  const buffer = stdout as unknown as Buffer;

  return [buffer[0], buffer[1], buffer[2]];
}

describe('html captions, real compile', () => {
  it('composites the caption track and lights each word while it is spoken', async () => {
    const descriptor = {
      global: { orientation: 'landscape', musicEnabled: false },
      sections: [
        {
          name: 'talk',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 2.5 },
          subtitles: SUBTITLES,
        },
      ],
    } as unknown as TemplateDescriptor;
    const projectConfig = {
      buildDir,
      assetsDir: libDir,
      currentLocale: 'en',
      audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
      videoConfig: { orientation: 'landscape', scale: '1280:720' },
      fields: {},
      userVideoPaths: {},
    } as unknown as ProjectConfig;

    const out = await compile(projectConfig, descriptor);

    expect(out, 'the html caption template should compile').not.toBeNull();

    const staged = fs.readdirSync(path.join(buildDir, 'panels'));

    expect(staged.filter((file) => file.endsWith('.ffconcat'))).toHaveLength(1);
    // Two cues' worth of looks at most (each word lit, none lit), plus the blank: never one per frame.
    expect(staged.filter((file) => file.startsWith('html-')).length).toBeLessThan(12);

    const plan = planSubtitles(SUBTITLES, {
      frame: { width: 1280, height: 720 },
      resolveText: (text) => text.en ?? text.text ?? '',
    });
    const first = plan?.cues[0].lines[0].words[0];

    if (!plan || !first) throw new Error('no plan');

    const size = plan.cues[0].size;
    const box = `${Math.round(first.width)}:${Math.round(size * 0.6)}:${Math.round(first.x)}:${Math.round(plan.cues[0].lines[0].top + size * 0.25)}`;
    const spoken = await averageRgb(out as string, 0.6, box);
    const later = await averageRgb(out as string, 1.4, box);

    // While spoken: yellow (red and green well above blue). Once the next word speaks: white again.
    expect(spoken[0] - spoken[2]).toBeGreaterThan(25);
    expect(Math.abs(later[0] - later[2])).toBeLessThan(10);
    expect(later[0]).toBeGreaterThan(40);
  }, 180_000);
});
