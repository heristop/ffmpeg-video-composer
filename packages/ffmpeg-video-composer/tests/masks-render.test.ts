import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { testBuildDir } from './fixtures/build-dir';

// Masks and layouts through real FFmpeg: a gradient + shimmer filled kinetic block, a texture fill, a
// split screen (colour / still / generated clip panes) and a before/after wipe must parse, render twice
// to the same bytes and land the expected pixels.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const buildDir = testBuildDir('masks-render');
const clip = path.join(buildDir, 'fixtures', 'bars.mp4');
const still = path.resolve(libDir, 'backgrounds/golden-hour.jpg');

const config = {
  buildDir,
  assetsDir: libDir,
  currentLocale: 'en',
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '640:360' },
} as unknown as ProjectConfig;

function descriptor(): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', musicEnabled: false, seed: 3, fps: 25 },
    sections: [
      {
        name: 'filled',
        type: 'color_background',
        options: { backgroundColor: '#101014', duration: 2 },
        kinetic: [
          {
            text: { en: 'SHINE ON' },
            preset: 'rise',
            size: 120,
            fill: {
              gradient: { from: '#FF3366', to: '#33CCFF', angle: 90 },
              sweep: { duration: 0.8, delay: 0.6, width: 50 },
            },
            effect: { shadow: true },
          },
        ],
      },
      {
        name: 'textured',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 1 },
        kinetic: [{ text: { en: 'GOLD' }, preset: 'fade', size: 150, fill: { texture: still } }],
      },
      {
        name: 'panes',
        type: 'color_background',
        options: { backgroundColor: '#FFFFFF', duration: 1 },
        layout: {
          type: 'split',
          sources: ['#FF0000', still, clip],
          gap: 10,
          divider: { color: '#00FF00', width: 4 },
        },
      },
      {
        name: 'wipe',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 2 },
        layout: {
          type: 'before-after',
          before: '#0000FF',
          after: 'filled',
          wipe: { at: 0.5, duration: 1, direction: 'right' },
          divider: { width: 6 },
        },
      },
    ],
  } as unknown as TemplateDescriptor;
}

async function render(): Promise<{ bytes: Buffer; manifest: RenderManifest; output: string }> {
  let manifest: RenderManifest | undefined;
  const output = await compile(config, descriptor(), { onManifest: (m) => (manifest = m) });

  expect(output).not.toBeNull();

  return { bytes: fs.readFileSync(output as string), manifest: manifest as RenderManifest, output: output as string };
}

// One RGB pixel of the frame at `time` seconds.
function pixel(file: string, time: number, x: number, y: number): number[] {
  const args = ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`];
  const raw = execFileSync('ffmpeg', [...args, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);

  return [...raw.subarray(0, 3)];
}

beforeAll(() => {
  fs.mkdirSync(path.dirname(clip), { recursive: true });
  const source = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=1'];
  execFileSync('ffmpeg', [...source, '-pix_fmt', 'yuv420p', clip]);
});

describe('masks and layouts', () => {
  it('validates cleanly', () => {
    const result = new TemplateValidator().validateTemplate(descriptor());

    expect(result.errors ?? []).toEqual([]);
  });

  it('renders twice to identical bytes, with the fill, panes and wipe where expected', async () => {
    const first = await render();
    const second = await render();
    const commands = first.manifest.graph.commands.join('\n');

    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(commands).toContain('alphamerge');
    expect(commands).toContain("lutyuv=y='clip((val-16)*255/219,0,255)'");
    expect(commands).toMatch(/pad=w=1280:h=360:x=640:y=0/);

    // Section starts: filled 0–2, textured 2–3, panes 3–4, wipe 4–6 (no transitions).
    const [red] = pixel(first.output, 3.5, 60, 180);
    const divider = pixel(first.output, 3.5, rectEdge(), 180);

    expect(red).toBeGreaterThan(200);
    expect(divider[1]).toBeGreaterThan(200);
    // Before the wipe: all blue; well after: the `filled` section's dark background on the left.
    expect(pixel(first.output, 4.2, 320, 20)[2]).toBeGreaterThan(200);
    expect(pixel(first.output, 5.8, 320, 20)[2]).toBeLessThan(80);
  }, 240000);
});

// The first pane boundary: pane widths split (640 - 2×10) evenly into three even widths.
function rectEdge(): number {
  return 206 + 5;
}
