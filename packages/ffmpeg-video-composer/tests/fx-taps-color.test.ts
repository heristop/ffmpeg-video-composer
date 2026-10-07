import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';
import { hasFfmpeg } from './fixtures/fx-test-kit';

// An fx layer that reads the picture under it (`taps`: bloom's highlight mask, the leak's shadow guard,
// grain, glass, resolve) forks the target region with `split`. Every output of a split shares one
// negotiated pixel format, so a tap converted to `gray` dragged the region, and the whole video section
// with it, to greyscale. Through the full compile path, a colourful clip keeps its saturation.

const dir = path.join(os.tmpdir(), 'leclap-fx-taps-color');
const clip = path.join(dir, 'colour.mp4');

const CASES: Record<string, unknown[]> = {
  none: [],
  bloom: [{ type: 'fx', effect: 'bloom', target: 'frame' }],
  leak: [{ type: 'fx', effect: 'leak', target: 'frame' }],
  grain: [{ type: 'fx', effect: 'grain', target: 'frame' }],
  'bloom + grain': [
    { type: 'fx', effect: 'bloom', target: 'frame' },
    { type: 'fx', effect: 'grain', target: 'frame' },
  ],
};

function saturation(file: string): number {
  const stats = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      '0.8',
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'signalstats,metadata=print:file=-',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' }
  );

  return Number(/SATAVG=([\d.]+)/.exec(stats)?.[1] ?? 0);
}

async function render(name: string): Promise<string> {
  const config = {
    buildDir: testBuildDir(`fx-taps-${name.replace(/\W+/g, '-')}`),
    currentLocale: 'en',
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '640:360' },
  } as unknown as ProjectConfig;
  const descriptor = {
    global: { orientation: 'landscape', musicEnabled: false, seed: 3, fps: 25 },
    sections: [{ name: 's', type: 'video', options: { videoUrl: clip, duration: 1.6 }, graphics: CASES[name] }],
  } as unknown as TemplateDescriptor;

  return (await compile(config, descriptor)) as string;
}

describe.skipIf(!hasFfmpeg())('fx layers that tap the picture keep its colour', () => {
  it('keeps a video section in colour under every tapped effect', async () => {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=640x360:r=25:d=2',
      '-f',
      'lavfi',
      '-i',
      'sine=d=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      clip,
    ]);

    const reference = saturation(await render('none'));
    const effects = Object.keys(CASES).filter((name) => name !== 'none');
    // One compile at a time (the engine's container is shared), chained rather than awaited in a loop.
    const results: Record<string, number> = {};

    await effects.reduce(async (previous, name) => {
      await previous;
      results[name] = saturation(await render(name));
    }, Promise.resolve());

    expect(reference).toBeGreaterThan(50);

    for (const name of effects) expect(results[name], name).toBeGreaterThan(reference * 0.8);
  }, 240000);
});
