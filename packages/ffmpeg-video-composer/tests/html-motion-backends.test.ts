import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';

const execFileAsync = promisify(execFile);

// The same animated card through every native FFmpeg a Node host can end up on: the system one and the
// bundled ffmpeg-static (an older FFmpeg). A backend that is not installed is skipped.
const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, '../../leclap-creative-kit/src/library');
const buildDir = testBuildDir('html-motion-backends');
const systemPath = process.env.PATH ?? '';
const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-backends-'));

function onPath(tool: string): string | null {
  try {
    return execFileSync('which', [tool], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

async function staticFfmpeg(): Promise<string | null> {
  try {
    const { default: binary } = await import('ffmpeg-static');

    return binary && fs.existsSync(binary) ? binary : null;
  } catch {
    return null;
  }
}

const systemFfmpeg = onPath('ffmpeg');
const systemFfprobe = onPath('ffprobe');
const bundled = await staticFfmpeg();

afterAll(() => {
  process.env.PATH = systemPath;
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.rmSync(toolDir, { recursive: true, force: true });
});

// A PATH whose `ffmpeg` is `binary`, with the system ffprobe beside it (ffmpeg-static ships none).
function pathWith(name: string, binary: string): string {
  const dir = path.join(toolDir, name);

  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(binary, path.join(dir, 'ffmpeg'));
  if (systemFfprobe) fs.symlinkSync(systemFfprobe, path.join(dir, 'ffprobe'));

  return dir;
}

async function averageRed(filePath: string, atSeconds: number): Promise<number> {
  const { stdout } = await execFileAsync(
    systemFfmpeg as string,
    ['-ss', String(atSeconds), '-i', filePath, '-vf', 'crop=40:40:230:230,scale=1:1', '-vframes', '1'].concat([
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ]),
    { encoding: 'buffer', maxBuffer: 1024 * 1024 }
  );

  return (stdout as unknown as Buffer)[0];
}

async function renderCard(): Promise<string> {
  const descriptor = {
    global: { orientation: 'landscape', musicEnabled: false },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 3 },
        inputs: [
          {
            name: 'dot',
            type: 'html',
            html: '<div class="dot" data-motion="dot"></div>',
            css: '.dot { width: 100px; height: 100px; background: #ff0000 }',
            width: 100,
            height: 100,
            options: { position: '200:200' },
            motion: {
              dot: {
                opacity: [
                  { t: 0.5, v: 0 },
                  { t: 0.7, v: 1 },
                ],
              },
            },
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

  expect(out, 'the animated card should compile').not.toBeNull();

  return out as string;
}

const backends = [
  { name: 'system ffmpeg', binary: systemFfmpeg },
  { name: 'ffmpeg-static', binary: bundled },
].filter((backend) => backend.binary !== null && systemFfprobe !== null && systemFfmpeg !== null);

describe('animated html card across native FFmpeg backends', () => {
  it.each(backends)(
    'animates on $name',
    async ({ name, binary }) => {
      process.env.PATH = `${pathWith(name.replaceAll(' ', '-'), binary as string)}${path.delimiter}${systemPath}`;

      const out = await renderCard();

      expect(await averageRed(out, 0.2)).toBeLessThan(30);
      expect(await averageRed(out, 1.5)).toBeGreaterThan(200);
    },
    120_000
  );
});
