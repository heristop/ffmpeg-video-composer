import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';

const execFileAsync = promisify(execFile);

// Real compile of an HTML layer: drawn by Satori + resvg in process, staged as html-<hash>.png and
// composited by the ordinary overlay path at its position, with its entrance motion.
const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, '../../leclap-creative-kit/src/library');
const buildDir = testBuildDir('html-layer-render');

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

describe('html layer, real compile', () => {
  it('draws the card where it is placed, after its entrance', async () => {
    const descriptor = {
      global: { orientation: 'landscape', musicEnabled: false, variables: { price: '420 000 €' } },
      sections: [
        {
          name: 'card',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 2 },
          inputs: [
            {
              name: 'price_tag',
              type: 'html',
              html: '<div class="tag"><span>Price</span><strong>{{ price }}</strong></div>',
              css:
                '.tag { display: flex; flex-direction: column; width: 100%; height: 100%; padding: 24px; ' +
                'border-radius: 32px; background: #ff2e4d; color: #ffffff; font: 600 40px Rubik }',
              width: 400,
              height: 200,
              options: { position: '200:200', motion: { type: 'fade', duration: 0.5 } },
            },
          ],
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

    expect(out, 'the html layer template should compile').not.toBeNull();

    const staged = fs.readdirSync(path.join(buildDir, 'panels')).filter((file) => file.startsWith('html-'));

    expect(staged).toHaveLength(1);

    // Inside the card, away from its text: the card red. Outside it: the black background.
    const inside = await averageRgb(out as string, 1.5, '40:40:220:330');
    const outside = await averageRgb(out as string, 1.5, '40:40:700:500');
    const early = await averageRgb(out as string, 0.02, '40:40:220:330');

    expect(inside[0]).toBeGreaterThan(200);
    expect(inside[1]).toBeLessThan(90);
    expect(outside.every((channel) => channel < 20)).toBe(true);
    expect(early[0]).toBeLessThan(inside[0] - 60);
  }, 120_000);
});
