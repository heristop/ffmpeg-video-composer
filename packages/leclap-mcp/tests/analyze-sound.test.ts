import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cueSeed, renderSoundWav, soundSpec, SoundSchema } from 'ffmpeg-video-composer';

import type { McpConfig } from '../src/config.js';
import { analyzeSoundOutputSchema, registerAnalyzeSound } from '../src/tools/analyzeSound.js';

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  structuredContent?: Record<string, unknown>;
}>;

function captureHandler(cfg: McpConfig): { name: string; handler: Handler } {
  let captured: { name: string; handler: Handler } | undefined;
  const fakeServer = {
    registerTool: (name: string, _meta: unknown, cb: Handler) => {
      captured = { name, handler: cb };
    },
  };

  registerAnalyzeSound(fakeServer as never, cfg);

  if (!captured) throw new Error('handler was not registered');

  return captured;
}

let outputDir: string;
let config: McpConfig;

beforeEach(async () => {
  outputDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-sound-')));
  config = { outputDir, mediaDir: outputDir, renderTimeoutMs: 1000, allowRemotion: false };
});

afterEach(async () => {
  await fs.rm(outputDir, { recursive: true, force: true });
});

const pop = {
  layers: [{ source: 'tone', pitch: { from: 400, to: 1200, time: 0.05 }, envelope: { attack: 0.002, decay: 0.12 } }],
};

async function isPng(file: string): Promise<boolean> {
  const bytes = await fs.readFile(file);

  return bytes.subarray(1, 4).toString('latin1') === 'PNG';
}

describe('analyze_sound', () => {
  it('renders a composed sound and returns its numbers, the WAV and two PNGs', async () => {
    const { name, handler } = captureHandler(config);
    const result = await handler({ sound: pop });
    const data = result.structuredContent as Record<string, unknown>;

    expect(name).toBe('analyze_sound');
    expect(result.isError).toBeUndefined();
    expect(data).toMatchObject({ length: 0.122, peakDb: -3, warnings: [] });
    expect(data.centroidHz).toBeGreaterThan(400);
    expect(data.centroidHz).toBeLessThan(2000);
    expect(data.attackMs).toBeLessThan(10);
    expect(String(data.wav).startsWith(outputDir)).toBe(true);
    expect(await isPng(String(data.spectrogram))).toBe(true);
    expect(await isPng(String(data.waveform))).toBe(true);
    expect(result.content.filter((block) => block.type === 'image')).toHaveLength(2);
  });

  it('analyzes a varied preset and flags what the advisories would', async () => {
    const { handler } = captureHandler(config);
    const varied = await handler({ sound: { preset: 'boom', length: 1.6 }, music: true });
    const harsh = await handler({ sound: { length: 1, layers: [{ source: 'noise', envelope: { sustain: 1 } }] } });

    expect((varied.structuredContent as { length: number }).length).toBe(1.6);
    expect((varied.structuredContent as { warnings: Array<{ code: string }> }).warnings.map((w) => w.code)).toEqual([
      'sound_muddy',
    ]);
    expect((harsh.structuredContent as { warnings: Array<{ code: string }> }).warnings.map((w) => w.code)).toEqual([
      'sound_harsh',
    ]);
  });

  it('rejects an invalid sound with the schema issues', async () => {
    const { handler } = captureHandler(config);
    const result = await handler({ sound: { layers: [{ source: 'tone', pitch: 5 }] } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/layers\.0\.pitch/);
  });

  it('reports a silent sound with finite numbers and a sound_silent warning', async () => {
    const { handler } = captureHandler(config);
    const result = await handler({ sound: { layers: [{ source: 'silence', length: 1 }] } });
    const data = analyzeSoundOutputSchema.parse(result.structuredContent);

    expect(result.isError).toBeUndefined();
    expect(data).toMatchObject({ peakDb: -120, rmsDb: -120, rawPeakDb: -120 });
    expect(data.warnings.map((w) => w.code)).toEqual(['sound_silent']);
  });

  it('seeds a sound like the mix does for the cue it names', async () => {
    const { handler } = captureHandler(config);
    const hiss = { length: 0.3, layers: [{ source: 'noise', envelope: { decay: 0.2 } }] };
    const atCue = await handler({ sound: hiss, seed: 5, cue: 'sections.intro.sfx[0]' });
    const plain = await handler({ sound: hiss, seed: 5 });
    const data = analyzeSoundOutputSchema.parse(atCue.structuredContent);
    const expected = cueSeed(5, 'sections.intro.sfx[0]');

    expect(data.seed).toBe(expected);
    expect(analyzeSoundOutputSchema.parse(plain.structuredContent).seed).not.toBe(expected);
    expect(await fs.readFile(data.wav)).toEqual(
      Buffer.from(renderSoundWav(soundSpec(SoundSchema.parse(hiss)), expected))
    );
  });
});
