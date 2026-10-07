import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import { resolveCue } from '@/core/audio/sfx-cue';
import { deriveSeed } from '@/core/determinism/hash';
import { testBuildDir } from './fixtures/build-dir';

// A real render with one library cue and one composed sound: the synth writes its WAV into build/sfx, the
// mix takes it as an input like a library file, and the output has sound exactly where the cue lands.

const buildDir = testBuildDir('sfx-sound-render');

const config = {
  buildDir,
  assetsDir: path.join(buildDir, 'media'),
  currentLocale: 'en',
  audioConfig: { sampleRate: 48000, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '320:180' },
} as unknown as ProjectConfig;

const thump = {
  length: 0.4,
  layers: [
    { source: 'noise', color: 'pink', filter: { type: 'lowpass', from: 6000, to: 400 }, envelope: { decay: 0.3 } },
    { source: 'strike', pitch: { from: 160, to: 60 }, ring: 0.35, click: 0.4 },
  ],
  fx: { saturate: 0.3 },
};

function silences(file: string): Array<[number, number]> {
  const run = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', file, '-af', 'silencedetect=n=-50dB:d=0.1', '-f', 'null', '-'],
    {
      encoding: 'utf8',
    }
  );
  const starts = [...run.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((match) => Number(match[1]));
  const ends = [...run.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((match) => Number(match[1]));

  return starts.map((start, i) => [start, ends[i] ?? Number.POSITIVE_INFINITY]);
}

function silentAt(stretches: Array<[number, number]>, t: number): boolean {
  return stretches.some(([start, end]) => t >= start && t <= end);
}

describe('composed sounds in a real render', () => {
  it('renders the sound to build/sfx, mixes it like a library file and plays it at its cue', async () => {
    const captured: { manifest?: RenderManifest; error?: Error } = {};
    const descriptor = {
      meta: { name: 'sfx-sound' },
      global: { musicEnabled: false, seed: 3 },
      sections: [
        {
          type: 'color_background',
          name: 'a',
          options: { backgroundColor: '#202030', duration: 4 },
          sfx: [
            { id: 'pop', at: 0.5 },
            { sound: thump, at: 2.5 },
          ],
        },
      ],
    } as unknown as TemplateDescriptor;
    const output = await compile(config, descriptor, {
      onManifest: (manifest) => (captured.manifest = manifest),
      onError: (error) => (captured.error = error),
    });

    expect(captured.error).toBeUndefined();

    const file = resolveCue({ sound: thump, at: 2.5 } as never, deriveSeed(3, 'sections.a.sfx[1]'))?.file ?? '';
    const wav = path.join(buildDir, 'sfx', file);

    expect(fs.existsSync(wav)).toBe(true);
    expect(fs.readFileSync(wav).subarray(0, 4).toString('latin1')).toBe('RIFF');

    const commands = captured.manifest?.graph.commands.join('\n') ?? '';

    expect(commands).toContain(file);
    expect(commands).toContain('adelay=2500|2500');

    const stretches = silences(String(output));

    // pop 0.5–0.65, the composed thump 2.5–2.9.
    for (const t of [1.5, 3.5]) expect(silentAt(stretches, t), `silent at ${t}`).toBe(true);

    for (const t of [0.55, 2.6]) expect(silentAt(stretches, t), `sound at ${t}`).toBe(false);
  }, 240000);
});
