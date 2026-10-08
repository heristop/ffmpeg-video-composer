import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';

// A section and one of its inputs sharing a `name` ("badge" overlaid on section "badge") used to break
// the filtergraph: the engine keyed the section's own background and the input by that one name, so one
// `-i` went missing ("Invalid file index") or the overlay read the wrong stream. Real ffmpeg, one card each.
const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, '../../leclap-creative-kit/src/library');

const projectConfig = (buildDir: string) =>
  ({
    buildDir,
    assetsDir: libDir,
    currentLocale: 'en',
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '640:360' },
    fields: {},
    userVideoPaths: {},
  }) as unknown as ProjectConfig;

const badge = { name: 'badge', type: 'image', url: 'pictures/logo.png', options: { position: '20:20' } };

// Mean luma of a region at 0.5s, by cropping it and scaling it down to one pixel.
async function luma(file: string, crop: string): Promise<number> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-ss',
      '0.5',
      '-i',
      file,
      '-vf',
      `crop=${crop},scale=1:1`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'pipe:1',
    ],
    { encoding: 'buffer' }
  );

  return (stdout as unknown as Buffer)[0];
}

// The white logo sits at the top-left; the top-right corner is bare background.
async function expectBadgeVisible(file: string): Promise<void> {
  const badgeRegion = await luma(file, '300:300:20:20');
  const background = await luma(file, '100:100:520:20');

  expect(badgeRegion).toBeGreaterThan(background + 25);
}

async function render(
  suite: string,
  section: Record<string, unknown>
): Promise<{ out: string | null; errors: Error[] }> {
  const buildDir = testBuildDir(suite);
  fs.rmSync(buildDir, { recursive: true, force: true });
  const errors: Error[] = [];
  const descriptor = {
    global: { orientation: 'landscape', musicEnabled: false },
    sections: [section],
  } as unknown as TemplateDescriptor;

  const out = await compile(projectConfig(buildDir), descriptor, { onError: (error) => errors.push(error) });

  return { out, errors };
}

describe('a section and an input with the same name', () => {
  it('renders a color card overlaid with an image input named after the section', async () => {
    const { out, errors } = await render('name-clash-color', {
      name: 'badge',
      type: 'color_background',
      options: { backgroundColor: '#202020', duration: 1 },
      inputs: [badge],
    });

    expect(errors.map((error) => error.message)).toEqual([]);
    await expectBadgeVisible(out as string);
  }, 120000);

  it('renders an image card overlaid with an image input named after the section', async () => {
    const { out, errors } = await render('name-clash-image', {
      name: 'badge',
      type: 'image_background',
      options: { pictureUrl: 'pictures/empty-1280.png', duration: 1 },
      inputs: [badge],
    });

    expect(errors.map((error) => error.message)).toEqual([]);
    await expectBadgeVisible(out as string);
  }, 120000);
});
