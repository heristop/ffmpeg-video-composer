import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import {
  analyzeChannels,
  canonicalJson,
  deriveSeed,
  renderSound,
  renderSoundWav,
  sha256Hex,
  soundFindings,
  soundSpec,
  soundUsesSeed,
  SoundSchema,
} from 'ffmpeg-video-composer';
import { z } from 'zod';

import type { McpConfig } from '../config.js';

// analyze_sound: the ears of an agent composing a sound effect. Renders a `sound` (composed layers, or a
// library preset with its variations) through the same synth the mix uses, writes the WAV under the output
// dir, measures it and draws a spectrogram and a waveform with FFmpeg (system binary first, then
// ffmpeg-static). Numbers: length, sample peak and RMS level in dBFS (plain RMS over the whole sound, not
// LUFS), the raw layer-sum peak before normalisation, spectral centroid, the share of energy above 8 kHz
// and under 250 Hz, and the attack time; plus the sound advisories it would raise in a template.

const execFileAsync = promisify(execFile);
const requireModule = createRequire(import.meta.url);

const inputSchema = z.object({
  sound: z
    .record(z.string(), z.unknown())
    .describe('A `sfx[].sound`: { layers, length?, fx? } or { preset, pitch?, length?, brightness?, room? }.'),
  seed: z.number().int().min(0).max(0xffffffff).optional().describe('Seed of its noise and jitter (default 0).'),
  music: z.boolean().optional().describe('Whether music plays under it (enables the sound_muddy check).'),
});

const warningSchema = z.object({ code: z.string(), message: z.string(), hint: z.string().optional() });

const outputSchema = z.object({
  length: z.number(),
  peakDb: z.number(),
  rmsDb: z.number(),
  rawPeakDb: z.number(),
  centroidHz: z.number(),
  highShare: z.number(),
  lowShare: z.number(),
  attackMs: z.number(),
  warnings: z.array(warningSchema),
  wav: z.string(),
  spectrogram: z.string().optional(),
  waveform: z.string().optional(),
  note: z.string(),
});

type Args = z.infer<typeof inputSchema>;

const NOTE =
  'rmsDb is a plain RMS over the whole sound (dBFS), not LUFS; the render is peak-normalised to -3 dBFS, ' +
  'rawPeakDb is the layer sum before that. centroidHz ~ brightness (under 2 kHz warm, over 4 kHz bright).';

function errorResult(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}

function ffmpegBinaries(): string[] {
  try {
    const bundled = requireModule('ffmpeg-static') as string | null;

    return bundled ? ['ffmpeg', bundled] : ['ffmpeg'];
  } catch {
    return ['ffmpeg'];
  }
}

// Each binary in turn until one draws the picture.
async function ffmpeg(args: string[], signal?: AbortSignal, binaries = ffmpegBinaries()): Promise<boolean> {
  if (binaries.length === 0) return false;

  const [binary, ...rest] = binaries;

  try {
    await execFileAsync(binary, ['-v', 'error', '-y', ...args], { signal });

    return true;
  } catch {
    return signal?.aborted ? false : ffmpeg(args, signal, rest);
  }
}

// Spectrogram (log magnitude, linear frequency to 24 kHz) and a stereo waveform, both 800 px wide.
async function pictures(dir: string, wav: string, signal?: AbortSignal) {
  const spectrogram = path.join(dir, 'spectrogram.png');
  const waveform = path.join(dir, 'waveform.png');
  const drawnSpectrogram = await ffmpeg(
    ['-i', wav, '-lavfi', 'showspectrumpic=s=800x400:legend=1:scale=log', spectrogram],
    signal
  );
  const drawnWaveform = await ffmpeg(
    [
      '-i',
      wav,
      '-filter_complex',
      'showwavespic=s=800x240:split_channels=1:colors=0x9b8cff|0x9b8cff',
      '-frames:v',
      '1',
      waveform,
    ],
    signal
  );

  return {
    ...(drawnSpectrogram ? { spectrogram } : {}),
    ...(drawnWaveform ? { waveform } : {}),
  };
}

async function imageBlocks(files: Array<string | undefined>) {
  const present = files.filter((file): file is string => file !== undefined);
  const bytes = await Promise.all(present.map((file) => fs.readFile(file)));

  return bytes.map((data) => ({ type: 'image' as const, data: data.toString('base64'), mimeType: 'image/png' }));
}

function measure(args: Args, sound: ReturnType<typeof SoundSchema.parse>) {
  const spec = soundSpec(sound);
  const seed = soundUsesSeed(spec) ? deriveSeed(args.seed ?? 0, 'analyze_sound') : 0;
  const rendered = renderSound(spec, seed);
  const metrics = analyzeChannels([rendered.left, rendered.right]);
  const warnings = soundFindings('sound', { ...metrics, peak: rendered.peak }, args.music ?? false).map(
    ({ code, message, hint }) => ({ code, message, hint })
  );

  return { spec, seed, rendered, metrics, warnings };
}

async function handleAnalyze(args: Args, config: McpConfig, signal?: AbortSignal) {
  const parsed = SoundSchema.safeParse(args.sound);

  if (!parsed.success) {
    return errorResult(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
  }

  const { spec, seed, rendered, metrics, warnings } = measure(args, parsed.data);
  const dir = path.join(config.outputDir, 'sounds', sha256Hex(canonicalJson({ spec, seed })).slice(0, 16));
  const wav = path.join(dir, 'sound.wav');

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(wav, renderSoundWav(spec, seed));

  const drawn = await pictures(dir, wav, signal);
  const rawPeakDb = Number((20 * Math.log10(Math.max(rendered.peak, 1e-9))).toFixed(2));
  const result = { length: metrics.duration, ...metrics, rawPeakDb, warnings, wav, ...drawn, note: NOTE };
  const summary =
    `${metrics.duration} s, peak ${metrics.peakDb} dBFS, RMS ${metrics.rmsDb} dBFS, centroid ${metrics.centroidHz} Hz, ` +
    `attack ${metrics.attackMs} ms${warnings.length > 0 ? `; ${warnings.map((w) => w.code).join(', ')}` : ''}. Files in ${dir}.`;
  const { duration: _duration, ...structured } = result;

  return {
    content: [{ type: 'text' as const, text: summary }, ...(await imageBlocks([drawn.spectrogram, drawn.waveform]))],
    structuredContent: structured,
  };
}

export function registerAnalyzeSound(server: McpServer, config: McpConfig) {
  server.registerTool(
    'analyze_sound',
    {
      title: 'Analyze Sound',
      description:
        'Render a sfx `sound` (composed layers, or { preset, pitch, length, brightness, room }) with the engine ' +
        'synth and measure it: length, peak and RMS dBFS, raw pre-normalisation peak, spectral centroid ' +
        '(brightness), energy share above 8 kHz / under 250 Hz, attack ms, the sound advisories it raises, ' +
        'and a spectrogram + waveform PNG. Iterate until the numbers match the intent.',
      inputSchema,
      outputSchema,
    },
    (args: Args, ctx?: ServerContext) => handleAnalyze(args, config, ctx?.mcpReq.signal)
  );
}
