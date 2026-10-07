import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { parseCommand } from '@/platform/ffmpeg/parse-command';
import { testBuildDir } from './fixtures/build-dir';

// The sheen through the whole compile path: the rounded mask sprite is generated and staged by the asset
// stage, the section is promoted to a complex graph for its extra input, and two renders are identical.

const config = {
  buildDir: testBuildDir('fx-sheen-compile'),
  currentLocale: 'en',
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '640:360' },
} as unknown as ProjectConfig;

const card = { x: 'iw*0.2', y: 'ih*0.25', w: 'iw*0.6', h: 'ih*0.5' };

function descriptor(): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', musicEnabled: false, seed: 7, fps: 25 },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#121826', duration: 1.4, layers: [{ color: '#7F8BA3', ...card }] },
        graphics: [{ type: 'fx', effect: 'sheen', at: 0.2, target: { ...card, radius: 20 }, color: '$color.fg' }],
        kinetic: [{ text: { en: 'SHINE' }, preset: 'fade', size: 90 }],
      },
      {
        name: 'title',
        type: 'color_background',
        options: { backgroundColor: '#303845', duration: 1 },
        kinetic: [{ text: { en: 'GLOW' }, preset: 'fade', size: 120 }],
        graphics: [{ type: 'fx', effect: 'sheen', target: 'text:0', profile: 'twin', repeat: 2, every: 0.5 }],
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

async function render(): Promise<{ bytes: Buffer; commands: string; list: string[] }> {
  let manifest: RenderManifest | undefined;
  const output = await compile(config, descriptor(), { onManifest: (m) => (manifest = m) });
  const list = manifest?.graph.commands ?? [];

  return { bytes: fs.readFileSync(output as string), commands: list.join('\n'), list };
}

// Decoded-frame checksums of one segment command, its filtergraph run on `threads` slice threads. The
// output codec is swapped for rawvideo, so only the filtergraph is compared (not the encoder).
function frameHashes(command: string, threads: number): string {
  const args = parseCommand(command.replaceAll('$BUILD', config.buildDir as string)).slice(0, -1);

  return execFileSync(
    'ffmpeg',
    ['-v', 'error', '-filter_threads', String(threads), ...args, '-an', '-c:v', 'rawvideo', '-f', 'framemd5', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 }
  );
}

describe.skipIf(!hasFfmpeg())('fx sheen compile', () => {
  it('validates cleanly', () => {
    expect(new TemplateValidator().validateTemplate(descriptor()).errors ?? []).toEqual([]);
  });

  it('renders a rounded-card and a text-target sheen twice to identical bytes', async () => {
    const first = await render();
    const second = await render();

    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(first.commands).toContain('gradients=s=');
    expect(first.commands).toMatch(/sprite-mask-[0-9a-f]{8}\.png/);
    expect(first.commands).toContain('alphamerge');
    expect(first.commands).toContain('eof_action=pass');
  }, 240000);

  // FFmpeg's overlay, given a main WITH alpha, blends chroma from the main's alpha rows while the
  // neighbouring slice job rewrites them (its alpha composite): the result depended on the slice count and
  // on thread scheduling. Text drawn before the effect leaves partial alpha in the main, so the title
  // section is the case that raced. The sub-graph pins an opaque frame; any thread count gives one result.
  it('composites independently of the filter thread count', async () => {
    const { list } = await render();
    const segments = list.filter((command) => command.includes('fx0_'));

    expect(segments).toHaveLength(2);

    for (const command of segments) {
      const single = frameHashes(command, 1);

      for (const threads of [3, 5, 8]) expect(frameHashes(command, threads)).toBe(single);
    }
  }, 240000);
});
