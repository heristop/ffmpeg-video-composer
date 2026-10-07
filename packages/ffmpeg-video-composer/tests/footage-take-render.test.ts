import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import type { QcFinding, QcReport } from '@/core/qc/types';
import { mediaTraits, type ProbeVideoStream } from '@/core/footage/media-traits';
import { testBuildDir } from './fixtures/build-dir';

// Footage features on real renders, from clips synthesized on the fly: a take with silent gaps
// (aevalsrc), a B-roll clip for a cutaway, a rotated phone-style clip and an HDR (PQ) tagged clip.

const buildDir = testBuildDir('footage-take-render');
const assetsDir = path.join(buildDir, 'media');
const clips = {
  take: path.join(assetsDir, 'take.mp4'),
  main: path.join(assetsDir, 'main.mp4'),
  broll: path.join(assetsDir, 'broll.mp4'),
  rotated: path.join(assetsDir, 'rotated.mp4'),
  hdr: path.join(assetsDir, 'hdr.mp4'),
  vfr: path.join(assetsDir, 'vfr.mp4'),
  lut: path.join(assetsDir, 'warm.cube'),
};

// Whether the FFmpeg on PATH has a filter (the tone-map needs zscale + tonemap).
function buildHas(filter: string): boolean {
  return new RegExp(`\\s${filter}\\s`).test(execFileSync('ffmpeg', ['-hide_banner', '-filters']).toString());
}

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
}

function probeStream(file: string): ProbeVideoStream & { width: number; height: number } {
  const out = execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', file]).toString();

  return (
    JSON.parse(out) as { streams: Array<ProbeVideoStream & { codec_type: string; width: number; height: number }> }
  ).streams.find((stream) => stream.codec_type === 'video')!;
}

function duration(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);

  return Number(out.toString().trim());
}

// RGB of a single pixel of the frame at `seconds` (the frame scaled to 1x1 = its average colour, or a crop).
function pixel(file: string, seconds: number, crop = 'scale=1:1'): number[] {
  const out = execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-ss',
    String(seconds),
    '-i',
    file,
    '-frames:v',
    '1',
    '-vf',
    crop,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ]);

  return [...out.subarray(0, 3)];
}

const video = (seconds: number, source = 'testsrc2=') => ['-f', 'lavfi', '-i', `${source}s=320x180:r=30:d=${seconds}`];
const x264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];

beforeAll(() => {
  fs.mkdirSync(assetsDir, { recursive: true });
  // Silence 0–0.8 s, speech 0.8–1.8 s, a 1.5 s pause, speech 3.3–4.3 s, silence to 5.5 s.
  const speech = "aevalsrc='0.5*sin(2*PI*440*t)*(between(t,0.8,1.8)+between(t,3.3,4.3))':s=44100:d=5.5";
  ffmpeg([...video(5.5), '-f', 'lavfi', '-i', speech, ...x264, '-c:a', 'aac', '-shortest', clips.take]);
  ffmpeg([...video(3), '-f', 'lavfi', '-i', 'sine=f=330:d=3:sample_rate=44100', ...x264, '-c:a', 'aac', clips.main]);
  ffmpeg([...video(2, 'color=c=red:'), '-f', 'lavfi', '-i', 'sine=f=880:d=2', ...x264, '-c:a', 'aac', clips.broll]);
  // Left half red, right half blue, displayed rotated by 90°.
  const halves = 'color=c=red:s=320x180:r=30:d=1,drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill';
  ffmpeg(['-f', 'lavfi', '-i', halves, ...x264, path.join(assetsDir, 'upright.mp4')]);
  ffmpeg(['-display_rotation', '90', '-i', path.join(assetsDir, 'upright.mp4'), '-c', 'copy', clips.rotated]);
  ffmpeg([
    ...video(1),
    // FFmpeg 8 takes the colour tags from the frames, so they are set on the frames as well as the stream.
    '-vf',
    'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p10le',
    '-color_primaries',
    'bt2020',
    '-color_trc',
    'smpte2084',
    '-colorspace',
    'bt2020nc',
    clips.hdr,
  ]);
  ffmpeg([...video(2), '-vf', "select='not(between(t,0.5,1.2))'", '-fps_mode', 'vfr', ...x264, clips.vfr]);
  // A 2-point warming cube: identity with red lifted.
  const rows = [0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${Math.min(1, r + 0.1)} ${g} ${b}`)));
  fs.writeFileSync(clips.lut, ['TITLE "warm"', 'LUT_3D_SIZE 2', ...rows, ''].join('\n'));
});

const config = {
  buildDir,
  assetsDir,
  currentLocale: 'en',
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '320:180' },
  qc: true,
} as unknown as ProjectConfig;

async function render(
  descriptor: TemplateDescriptor,
  extra: Partial<ProjectConfig> = {}
): Promise<{ output: string; qc: QcReport; manifest: RenderManifest; logs: string[] }> {
  const captured: { qc?: QcReport; manifest?: RenderManifest; error?: Error } = {};
  const logs: string[] = [];
  const output = await compile({ ...config, ...extra }, descriptor, {
    onQc: (report) => (captured.qc = report),
    onManifest: (manifest) => (captured.manifest = manifest),
    onError: (error) => (captured.error = error),
    onLog: (entry) => logs.push(JSON.stringify(entry)),
  });

  expect(captured.error).toBeUndefined();
  expect(output).not.toBeNull();

  return { output: output!, qc: captured.qc!, manifest: captured.manifest!, logs };
}

function check(report: QcReport, name: string): QcFinding | undefined {
  return report.findings.find((finding) => finding.check === name);
}

describe('probe traits of synthesized clips', () => {
  it('reads HDR transfer, bit depth, VFR and rotation off ffprobe', () => {
    expect(mediaTraits(probeStream(clips.hdr))).toMatchObject({
      hdr: 'pq',
      colorPrimaries: 'bt2020',
      colorTransfer: 'smpte2084',
      bitDepth: 10,
      rotation: 0,
    });
    expect(mediaTraits(probeStream(clips.vfr)).vfr).toBe(true);
    expect(mediaTraits(probeStream(clips.main))).toMatchObject({ hdr: null, bitDepth: 8, vfr: false, rotation: 0 });
    expect(mediaTraits(probeStream(clips.rotated)).rotation).toBe(90);
  });
});

describe('footage edits on real renders', () => {
  it('trims leading, trailing and long silences out of a take', async () => {
    const { output, qc, manifest } = await render(
      {
        meta: { name: 'trim-silence' },
        global: { musicEnabled: false },
        sections: [{ type: 'project_video', name: 'take', options: { trimSilence: { gaps: {} } } }],
      } as unknown as TemplateDescriptor,
      { userVideoPaths: { take: clips.take } }
    );

    // Kept: [0.65, 1.95] and [3.15, 4.45] (0.15 s margins around the speech) = 2.6 s of the 5.5 s take.
    expect(duration(output)).toBeGreaterThan(2.45);
    expect(duration(output)).toBeLessThan(2.8);
    expect(check(qc, 'duration')?.status).toBe('pass');
    expect(manifest.graph.commands.some((command) => command.includes('concat=n=2:v=1:a=1'))).toBe(true);
  }, 240000);

  it('cuts explicit keep windows on every backend (no analysis needed)', async () => {
    const { output, qc } = await render(
      {
        meta: { name: 'keep-windows' },
        global: { musicEnabled: false },
        sections: [
          {
            type: 'project_video',
            name: 'take',
            options: {
              keep: [
                [0.5, 1.5],
                [3, 4],
              ],
              audioFade: { out: { duration: 0.3 } },
            },
          },
        ],
      } as unknown as TemplateDescriptor,
      { userVideoPaths: { take: clips.take } }
    );

    expect(Math.abs(duration(output) - 2)).toBeLessThan(0.12);
    expect(check(qc, 'duration')?.status).toBe('pass');
  }, 240000);

  it('overlays a B-roll cutaway for its window and keeps the main timeline', async () => {
    const { output, qc } = await render({
      meta: { name: 'cutaway' },
      global: { musicEnabled: false },
      sections: [
        {
          type: 'video',
          name: 'main',
          options: { duration: 3, videoUrl: clips.main, muteSection: false },
          cues: { broll: 1 },
          // A time reference: the section's named cue.
          cutaways: [{ url: clips.broll, at: 'cue:broll', duration: 1, audio: 'b' }],
        },
      ],
    } as unknown as TemplateDescriptor);
    const [r, g, b] = pixel(output, 1.5);
    const before = pixel(output, 0.4);

    expect(Math.abs(duration(output) - 3)).toBeLessThan(0.1);
    expect(check(qc, 'duration')?.status).toBe('pass');
    expect(r).toBeGreaterThan(200);
    expect(g + b).toBeLessThan(80);
    expect(before[1] + before[2]).toBeGreaterThan(80);
  }, 240000);

  it('autorotates a rotated clip before framing it', async () => {
    const { output } = await render(
      {
        meta: { name: 'rotated' },
        global: { musicEnabled: false },
        sections: [{ type: 'project_video', name: 'rotated', options: { duration: 1 } }],
      } as unknown as TemplateDescriptor,
      { userVideoPaths: { rotated: clips.rotated }, videoConfig: { orientation: 'landscape', scale: '180:320' } }
    );
    const top = pixel(output, 0.5, 'crop=180:40:0:20,scale=1:1');
    const bottom = pixel(output, 0.5, 'crop=180:40:0:260,scale=1:1');

    // Upright, the halves were left/right; displayed rotated they stack top/bottom.
    expect(probeStream(output)).toMatchObject({ width: 180, height: 320 });
    expect(Math.sign(top[0] - top[2])).not.toBe(Math.sign(bottom[0] - bottom[2]));
  }, 240000);

  it('tone-maps an HDR clip to SDR when the build has zscale + tonemap', async () => {
    const { manifest, output, logs } = await render(
      {
        meta: { name: 'hdr' },
        global: { musicEnabled: false },
        sections: [{ type: 'project_video', name: 'hdr', options: { duration: 1 } }],
      } as unknown as TemplateDescriptor,
      { userVideoPaths: { hdr: clips.hdr } }
    );

    const tonemapped = manifest.graph.commands.some((command) => command.includes('tonemap=hable:desat=0'));

    // Builds without zscale (some packaged FFmpeg 8 builds) keep the SDR pipeline and say so.
    expect(tonemapped).toBe(buildHas('zscale') && buildHas('tonemap'));
    expect(tonemapped || logs.some((entry) => entry.includes('hdr_source_sdr_pipeline'))).toBe(true);
    expect(probeStream(output)).toMatchObject({ pix_fmt: 'yuv420p' });

    if (tonemapped) expect(probeStream(output)).toMatchObject({ color_transfer: 'bt709' });
  }, 240000);

  it('applies a user .cube LUT at a strength and a dialled-down LUT look', async () => {
    const { manifest } = await render(
      {
        meta: { name: 'luts' },
        global: { musicEnabled: false },
        sections: [
          {
            type: 'project_video',
            name: 'main',
            options: { duration: 1 },
            look: { preset: 'teal-orange', strength: 0.5 },
            grade: { lut: { url: clips.lut, strength: 0.5 } },
          },
        ],
      } as unknown as TemplateDescriptor,
      { userVideoPaths: { main: clips.main } }
    );
    const commands = manifest.graph.commands.join('\n');

    expect(commands).toMatch(/lut3d=file='[^']*\/user-[0-9a-f]{16}-s0500\.cube'/);
    expect(commands).toContain("teal-orange-s0500.cube'");
  }, 240000);
});
