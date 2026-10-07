import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeMusicFile, beatsFromAnalysis, compile, type BeatAnalysis } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import { testBuildDir } from './fixtures/build-dir';

const execFileAsync = promisify(execFile);

// global.beats { analyze: 'music' } on Node: the compile measures the template's music track before the
// time-reference pass, so the render equals the one of the same template with the measured grid written
// out by hand. The track is a 120 BPM click generated with FFmpeg's aevalsrc.

const buildDir = testBuildDir('beats-compile');

function descriptor(beats: unknown): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', fps: 30, musicEnabled: true, music: { name: 'clicks' }, beats },
    sections: [
      { name: 'intro', type: 'color_background', options: { backgroundColor: '#101014', duration: { beats: 4 } } },
      {
        name: 'hit',
        type: 'color_background',
        options: { backgroundColor: '#202024', duration: 2 },
        graphics: [{ type: 'flash', at: 'beat:6', duration: 0.2 }],
      },
    ],
  } as unknown as TemplateDescriptor;
}

describe('global.beats { analyze: "music" } — Node compile', () => {
  let assetsDir: string;
  let track: string;
  let measured: BeatAnalysis;

  beforeAll(async () => {
    assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fvc-beats-'));
    await fs.mkdir(path.join(assetsDir, 'musics'));
    // The music resolver looks for <assets>/musics/<name>.mp3; FFmpeg reads the WAV inside by content.
    track = path.join(assetsDir, 'musics', 'clicks.mp3');
    await execFileAsync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      "aevalsrc='if(lt(mod(t-0.1+10,0.5),0.01),0.8*sin(2*PI*1000*t),0)':s=22050:d=8",
      '-f',
      'wav',
      track,
    ]);
    measured = await analyzeMusicFile(track);
  });

  afterAll(async () => {
    await fs.rm(assetsDir, { recursive: true, force: true });
  });

  async function render(beats: unknown): Promise<string> {
    const config = {
      buildDir,
      assetsDir,
      currentLocale: 'en',
      videoConfig: { orientation: 'landscape', scale: '640:360' },
    } as unknown as ProjectConfig;
    let manifest: RenderManifest | undefined;

    expect(await compile(config, descriptor(beats), { onManifest: (m) => (manifest = m) })).not.toBeNull();

    return (manifest as RenderManifest).graph.commands.join('\n');
  }

  it('measures the generated click track', () => {
    expect(measured.bpm).toBeCloseTo(120, 0);
    expect(Math.abs(measured.offset - 0.1)).toBeLessThan(0.02);
    expect(measured.usable).toBe(true);
  });

  it('renders like the template with the measured grid written out', async () => {
    const analyzed = await render({ analyze: 'music' });
    const written = await render(beatsFromAnalysis(measured));

    expect(analyzed).toBe(written);
  }, 180_000);
});
