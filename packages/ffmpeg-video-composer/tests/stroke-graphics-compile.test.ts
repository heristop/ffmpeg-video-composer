import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { testBuildDir } from './fixtures/build-dir';

// The stroke graphics through the whole compile path: rounded arcs and caps are compile-time sprites
// staged by the asset stage (the section is promoted to a complex graph for them), the light card picks
// dark ink, and two renders are byte-identical.

const config = {
  buildDir: testBuildDir('stroke-graphics-compile'),
  currentLocale: 'en',
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '640:360' },
} as unknown as ProjectConfig;

const card = { x: 'iw*0.25', y: 'ih*0.25', w: 'iw*0.5', h: 'ih*0.5' };

function descriptor(): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', musicEnabled: false, seed: 7, fps: 25 },
    sections: [
      {
        name: 'light',
        type: 'color_background',
        options: { backgroundColor: '#F0E8DC', duration: 1.4, layers: [{ color: '#CDBFA9', ...card }] },
        graphics: [
          { type: 'corners', at: 0.1, target: 'layer:0', radius: 10 },
          { type: 'frame', at: 0.2, radius: 16, trace: 'split', until: 1.2 },
        ],
      },
      {
        name: 'dark',
        type: 'color_background',
        options: { backgroundColor: '#121826', duration: 1.2 },
        graphics: [{ type: 'underline', at: 0.1, x: 160, y: 200, width: 320, thickness: 10, caps: 'round' }],
      },
    ],
  } as unknown as TemplateDescriptor;
}

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

async function render(): Promise<{ bytes: Buffer; commands: string }> {
  let manifest: RenderManifest | undefined;
  const output = await compile(config, descriptor(), { onManifest: (m) => (manifest = m) });

  return { bytes: fs.readFileSync(output as string), commands: manifest?.graph.commands.join('\n') ?? '' };
}

describe.skipIf(!hasFfmpeg())('stroke graphics compile', () => {
  it('validates cleanly', () => {
    expect(new TemplateValidator().validateTemplate(descriptor()).errors ?? []).toEqual([]);
  });

  it('renders rounded frames, corners and capped underlines twice to identical bytes', async () => {
    const first = await render();
    const second = await render();

    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(first.commands).toMatch(/sprite-stroke-[0-9a-f]{8}\.png/);
    expect(first.commands).toMatch(/sprite-piece-[0-9a-f]{8}\.png/);
    // Dark ink on the light card (contrast: auto, colour unset).
    expect(first.commands).toContain('#16181D');
    expect(first.commands).toContain('fade=t=out');
  }, 240000);
});
