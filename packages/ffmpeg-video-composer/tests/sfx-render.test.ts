import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type { QcFinding, QcReport } from '@/core/qc/types';
import { SFX_IDS, SFX_LIBRARY } from '@/core/audio/sfx-library';
import { testBuildDir } from './fixtures/build-dir';

// Real renders with the bundled, synthesized sound effects: the sounds must be audible exactly where the
// template places them (silencedetect on the output), the voice presets must run in a real FFmpeg, and
// loudnorm must still hold its ceiling over the effects.

const here = path.dirname(fileURLToPath(import.meta.url));
const sfxDir = path.resolve(here, '../../leclap-creative-kit/src/library/sfx');
const buildDir = testBuildDir('sfx-render');
const assetsDir = path.join(buildDir, 'media');
const clip = path.join(assetsDir, 'voice.mp4');

const config = {
  buildDir,
  assetsDir,
  currentLocale: 'en',
  audioConfig: { sampleRate: 48000, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '320:180' },
  qc: { content: true },
} as unknown as ProjectConfig;

beforeAll(() => {
  fs.mkdirSync(assetsDir, { recursive: true });
  // A 3 s "recording": video plus a steady tone standing in for speech.
  const video = ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=3'];
  const tone = ['-f', 'lavfi', '-i', 'sine=f=220:d=3:sample_rate=48000'];
  const codecs = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'];

  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...video, ...tone, ...codecs, clip]);
});

async function render(
  descriptor: TemplateDescriptor,
  extra: Partial<ProjectConfig> = {}
): Promise<{ output: string; qc: QcReport; manifest: RenderManifest }> {
  const captured: { qc?: QcReport; manifest?: RenderManifest; error?: Error } = {};
  const output = await compile({ ...config, ...extra }, descriptor, {
    onQc: (report) => (captured.qc = report),
    onManifest: (manifest) => (captured.manifest = manifest),
    onError: (error) => (captured.error = error),
  });

  expect(captured.error).toBeUndefined();
  expect(output).not.toBeNull();

  return { output: output as string, qc: captured.qc as QcReport, manifest: captured.manifest as RenderManifest };
}

/** Silent stretches of the output's audio, [start, end] in seconds. */
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

function check(report: QcReport, name: string): QcFinding | undefined {
  return report.findings.find((finding) => finding.check === name);
}

describe('bundled sound-effect library', () => {
  it('ships every manifest entry with its declared length', () => {
    for (const id of SFX_IDS) {
      const { file, duration } = SFX_LIBRARY[id];
      const probe = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0'];
      const probed = execFileSync('ffprobe', [...probe, path.join(sfxDir, file)]);

      expect(Math.abs(Number(String(probed).trim()) - duration), id).toBeLessThan(0.03);
    }
  });
});

describe('sound effects in a real render', () => {
  it('plays each sound where the template places it, over silent sections', async () => {
    const { output, qc, manifest } = await render({
      meta: { name: 'sfx-timing' },
      global: { musicEnabled: false, sfx: [{ id: 'whoosh', at: 'b.start' }] },
      sections: [
        {
          type: 'color_background',
          name: 'a',
          options: { backgroundColor: '#202030', duration: 3 },
          sfx: [{ id: 'pop', at: 1 }],
        },
        {
          type: 'color_background',
          name: 'b',
          options: { backgroundColor: '#302020', duration: 3 },
          cues: { land: 1 },
          sfx: [{ id: 'hit', at: 'cue:land', volume: 0.9 }],
        },
      ],
    } as unknown as TemplateDescriptor);
    const stretches = silences(output);

    // pop 1.0–1.15, whoosh 3.0–3.6, hit 4.0–4.5 (b starts at 3 s).
    for (const t of [0.5, 2, 3.8, 5.5]) expect(silentAt(stretches, t), `silent at ${t}`).toBe(true);

    for (const t of [1.05, 3.3, 4.1]) expect(silentAt(stretches, t), `sound at ${t}`).toBe(false);

    expect(manifest.graph.commands.join('\n')).toContain('adelay=4000|4000');
    expect(check(qc, 'audio_present')).toMatchObject({ status: 'pass', expected: 'present' });
    expect(check(qc, 'duration')?.status).toBe('pass');
  }, 240000);

  it('runs a voice preset and clip automation on a recording, then loudnorm over a riser', async () => {
    const { output, qc, manifest } = await render(
      {
        meta: { name: 'sfx-voice' },
        global: { musicEnabled: false, audio: { normalize: 'loudnorm' } },
        sections: [
          {
            type: 'project_video',
            name: 'clip',
            options: {
              duration: 3,
              voice: 'clean',
              audioAutomation: [
                { at: 1, volume: 1 },
                { at: 1.4, volume: 0, ease: 'ease-in-out' },
              ],
            },
            cues: { drop: 2.8 },
            sfx: [{ id: 'riser', at: 'cue:drop' }],
          },
        ],
      } as unknown as TemplateDescriptor,
      { userVideoPaths: { clip } }
    );
    const commands = manifest.graph.commands.join('\n');

    expect(commands).toContain('acompressor=');
    expect(commands).toContain("volume=eval=frame:volume='max(0,");
    expect(commands).toMatch(/amix=inputs=2:duration=first:normalize=0,loudnorm=/);
    expect(silentAt(silences(output), 0.5)).toBe(false);
    expect(check(qc, 'audio_present')?.status).toBe('pass');
    expect(manifest.loudness).toMatchObject({ filter: 'loudnorm' });
    expect(['pass', 'warn']).toContain(check(qc, 'true_peak')?.status);
  }, 240000);
});
