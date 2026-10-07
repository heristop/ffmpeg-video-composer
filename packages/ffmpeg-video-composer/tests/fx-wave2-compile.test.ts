import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { testBuildDir } from './fixtures/build-dir';

// bokeh, dust, glass and resolve through the whole compile path: their sprites (bokeh discs, mote discs,
// the glass rim and mask, the resolve feather) are generated and staged by the asset stage, and two renders
// are byte-identical.

const config = {
  buildDir: testBuildDir('fx-wave2-compile'),
  currentLocale: 'en',
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '640:360' },
} as unknown as ProjectConfig;

const plate = { x: 'iw*0.1', y: 'ih*0.62', w: 'iw*0.8', h: 'ih*0.2', radius: 16 };

function descriptor(): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', musicEnabled: false, seed: 7, fps: 25 },
    sections: [
      {
        name: 'intro',
        type: 'color_background',
        options: { backgroundColor: '#121826', duration: 1.4 },
        kinetic: [{ text: { en: 'LECLAP' }, preset: 'fade', duration: 0.12, size: 80 }],
        graphics: [
          { type: 'fx', effect: 'bokeh', duration: 1.4 },
          { type: 'fx', effect: 'resolve', target: 'text:0', at: 0.3 },
        ],
      },
      {
        name: 'plate',
        type: 'color_background',
        options: {
          backgroundColor: '#8A8070',
          duration: 1.2,
          layers: [{ color: '#F4F0E8', x: plate.x, y: plate.y, w: plate.w, h: plate.h }],
        },
        kinetic: [{ text: { en: 'Alex Morgan' }, preset: 'fade', size: 40, color: '#FFFFFF' }],
        graphics: [
          { type: 'fx', effect: 'dust', duration: 1.2, count: 12 },
          { type: 'fx', effect: 'glass', target: plate, at: 0.1, duration: 1 },
        ],
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

describe.skipIf(!hasFfmpeg())('fx bokeh, dust, glass and resolve compile', () => {
  it('validates cleanly', () => {
    expect(new TemplateValidator().validateTemplate(descriptor()).errors ?? []).toEqual([]);
  });

  it('renders twice to identical bytes, with every sprite staged', async () => {
    const first = await render();
    const second = await render();

    expect(second.bytes.equals(first.bytes)).toBe(true);

    for (const kind of ['bokeh', 'disc', 'rim', 'mask', 'feather']) {
      expect(first.commands).toMatch(new RegExp(`sprite-${kind}-[0-9a-f]{8}\\.png`));
    }

    expect(first.commands).toContain('zoompan');
  }, 300000);
});
