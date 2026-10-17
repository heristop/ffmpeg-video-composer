import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { Filter, ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import { chainsThrough, clipParts, evenBox } from '@/editor/presets/clip-box';
import { kineticToFilters } from '@/editor/presets/kinetic';
import { encodePng } from '@/editor/presets/png-encode';
import { KineticBlockSchema, type KineticBlock } from '@/schemas/kinetic.schemas';
import { InputOptionsSchema } from '@/schemas/section.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';
import { testBuildDir } from './fixtures/build-dir';

// Clip boxes: a kinetic block or a layer cut to a box, so it reveals from behind an invisible edge on any
// background (footage included), by drawing it on a copy of the frame cropped back over the frame.

const FRAME = { width: 640, height: 360, fps: 30, duration: 2, seed: 1, energy: 1 };

describe('clip: schema', () => {
  it('a kinetic block takes block, line or a box', () => {
    const ok = (clip: unknown) => KineticBlockSchema.safeParse({ text: { en: 'Hi' }, preset: 'rise', clip }).success;

    expect(ok('block')).toBe(true);
    expect(ok('line')).toBe(true);
    expect(ok({ x: 10, y: 20, w: 300, h: 80 })).toBe(true);
    expect(ok('word')).toBe(false);
    expect(ok({ x: 10, y: 20, w: 0, h: 80 })).toBe(false);
    expect(ok({ x: 10, y: 20, w: 30 })).toBe(false);
  });

  it('a layer takes a box', () => {
    expect(InputOptionsSchema.safeParse({ clip: { x: 0, y: 0, w: 10, h: 10 } }).success).toBe(true);
    expect(InputOptionsSchema.safeParse({ clip: 'block' }).success).toBe(false);
  });

  it('bounds the box like the other px fields', () => {
    const ok = (clip: unknown) => InputOptionsSchema.safeParse({ clip }).success;

    expect(ok({ x: -20000, y: 20000, w: 20000, h: 20000 })).toBe(true);
    expect(ok({ x: 20001, y: 0, w: 10, h: 10 })).toBe(false);
    expect(ok({ x: 0, y: -20001, w: 10, h: 10 })).toBe(false);
    expect(ok({ x: 0, y: 0, w: 1e9, h: 10 })).toBe(false);
    expect(ok({ x: 0, y: 0, w: 10, h: 20001 })).toBe(false);
  });
});

describe('clip: lowering', () => {
  it('snaps the box out to even pixels inside the frame', () => {
    expect(evenBox({ x: 11, y: 5, w: 100, h: 41 }, 640, 360)).toEqual({ x: 10, y: 4, w: 102, h: 42 });
    expect(evenBox({ x: -20, y: 300, w: 100, h: 100 }, 640, 360)).toEqual({ x: 0, y: 300, w: 80, h: 60 });
    expect(evenBox({ x: 700, y: 0, w: 10, h: 10 }, 640, 360)).toBeNull();
  });

  it('draws on a copy, crops it to the box and lays it back', () => {
    const draw: Filter = { type: 'drawbox', value: 'x=0:y=0:w=50:h=50:c=white:t=fill' };

    expect(clipParts([{ box: { x: 10, y: 20, w: 100, h: 40 }, filters: [draw] }], FRAME, 'kc0_')).toEqual([
      {
        type: 'graph',
        graph: [
          { filters: [{ type: 'split', value: '2' }], outputs: ['kc0_o', 'kc0_d0'] },
          { inputs: ['kc0_d0'], filters: [draw], outputs: ['kc0_e0'] },
          { inputs: ['kc0_e0'], filters: [{ type: 'crop', value: '100:40:10:20' }], outputs: ['kc0_c0'] },
          { inputs: ['kc0_o', 'kc0_c0'], filters: [{ type: 'overlay', value: '10:20' }] },
        ],
      },
    ]);
    expect(clipParts([{ box: { x: 900, y: 0, w: 10, h: 10 }, filters: [draw] }], FRAME, 'kc0_')).toEqual([]);
  });

  it('flattens a sub-graph filter into the copy', () => {
    const graph: Filter = {
      type: 'graph',
      graph: [
        { filters: [{ type: 'null' }], outputs: ['g_b'] },
        { filters: [{ type: 'color', value: 'c=black' }], outputs: ['g_m'] },
        { inputs: ['g_b', 'g_m'], filters: [{ type: 'overlay', value: '0:0' }] },
      ],
    };

    expect(chainsThrough([{ type: 'null' }, graph], 'a', 'z', 'p')).toEqual([
      { inputs: ['a'], filters: [{ type: 'null' }], outputs: ['ps0'] },
      { inputs: ['ps0'], filters: [{ type: 'null' }], outputs: ['g_b'] },
      { filters: [{ type: 'color', value: 'c=black' }], outputs: ['g_m'] },
      { inputs: ['g_b', 'g_m'], filters: [{ type: 'overlay', value: '0:0' }], outputs: ['ps1'] },
      { inputs: ['ps1'], filters: [{ type: 'null' }], outputs: ['z'] },
    ]);
  });

  it('cuts a block to its own box, or each line to its own', () => {
    const block = { text: { en: 'HELLO\nWORLD' }, preset: 'rise', size: 60, font: 'bebas' } as KineticBlock;
    const plain = kineticToFilters(block, { ...FRAME, text: 'HELLO\nWORLD' });
    const whole = kineticToFilters({ ...block, clip: 'block' }, { ...FRAME, text: 'HELLO\nWORLD', index: 2 });
    const lines = kineticToFilters({ ...block, clip: 'line' }, { ...FRAME, text: 'HELLO\nWORLD', index: 2 });
    const crops = (filters: Filter[]) =>
      (filters[0].graph ?? []).flatMap((chain) => chain.filters.filter((f) => f.type === 'crop').map((f) => f.value));

    expect(whole).toHaveLength(1);
    expect(whole[0].graph?.[0].outputs).toEqual(['kc2_o', 'kc2_d0']);
    expect(crops(whole)).toHaveLength(1);
    // The same drawtexts, untouched, inside the copy.
    expect(whole[0].graph?.flatMap((chain) => chain.filters).filter((f) => f.type === 'drawtext')).toEqual(plain);
    expect(crops(lines)).toHaveLength(2);
    expect(lines[0].graph?.[0].filters).toEqual([{ type: 'split', value: '3' }]);
    expect(kineticToFilters({ ...block, clip: 'block' }, { ...FRAME, text: 'HELLO\nWORLD' })).toEqual(
      kineticToFilters({ ...block, clip: 'block' }, { ...FRAME, text: 'HELLO\nWORLD' })
    );
  });

  it('keeps a unit opaque when its slot edge reveals it, and fades it when the slot cannot hide it', () => {
    const alphas = (block: KineticBlock) =>
      kineticToFilters(block, { ...FRAME, text: 'HELLO' })
        .flatMap((f) => (f.graph ?? [{ filters: [f] }]).flatMap((chain) => chain.filters))
        .filter((f) => f.type === 'drawtext')
        .map((f) => (f.values as Record<string, unknown>).alpha);
    const base = { text: { en: 'HELLO' }, preset: 'rise', size: 60, font: 'bebas', unit: 'line' } as KineticBlock;
    const exit = { preset: 'drop', at: 1, distance: 80 } as const;

    expect(alphas({ ...base, clip: 'line', distance: 80, exit })).toEqual(["'clip(1,0,1)'"]);
    // A short travel leaves the unit partly inside its slot: it still fades in.
    expect(alphas({ ...base, clip: 'line', distance: 20 })[0]).toContain('if(');
    expect(alphas({ ...base, distance: 80 })[0]).toContain('if(');
  });
});

// Real FFmpeg over moving footage: the clipped block and layer never leave their boxes, and land whole.
const buildDir = testBuildDir('clip-box-render');
const footage = path.join(buildDir, 'fixtures', 'footage.mp4');
const card = path.join(buildDir, 'fixtures', 'card.png');

const here = path.dirname(fileURLToPath(import.meta.url));
const config = {
  buildDir,
  assetsDir: path.resolve(here, '../../leclap-creative-kit/src/library'),
  currentLocale: 'en',
  audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
  videoConfig: { orientation: 'landscape', scale: '640:360' },
} as unknown as ProjectConfig;

const LAYER_BOX = { x: 220, y: 200, w: 200, h: 100 };

function descriptor(clipped: boolean, drawn = true): TemplateDescriptor {
  const kinetic = [
    {
      text: { en: 'Hello!' },
      preset: 'rise',
      size: 90,
      distance: 120,
      delay: 0.1,
      ...(clipped ? { clip: 'block' } : {}),
    },
  ];
  const layer = {
    name: 'card',
    type: 'image',
    url: card,
    options: {
      position: '220:200',
      scale: '200:100',
      animate: { y: [{ v: '+110' }, { t: 0.8, v: '+0' }] },
      ...(clipped ? { clip: LAYER_BOX } : {}),
    },
  };

  return {
    global: { orientation: 'landscape', musicEnabled: false, fps: 30 },
    sections: [
      {
        name: 'text',
        type: 'video',
        options: { duration: 1.5, videoUrl: footage, muteSection: false },
        ...(drawn ? { kinetic } : {}),
      },
      {
        name: 'layer',
        type: 'video',
        options: { duration: 1.5, videoUrl: footage, muteSection: false },
        ...(drawn ? { inputs: [layer] } : {}),
      },
    ],
  } as unknown as TemplateDescriptor;
}

async function render(d: TemplateDescriptor): Promise<{ frames: Buffer[]; commands: string }> {
  let manifest: RenderManifest | undefined;
  const output = (await compile(config, d, { onManifest: (m) => (manifest = m) })) as string;
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {
    maxBuffer: 1 << 29,
  });
  const size = 640 * 360;

  return {
    frames: Array.from({ length: raw.length / size }, (_, i) => raw.subarray(i * size, (i + 1) * size)),
    commands: (manifest as RenderManifest).graph.commands.join('\n'),
  };
}

// Pixels differing by more than 40 grey levels, outside `box` grown by `margin` (or everywhere without one).
function changed(a: Buffer, b: Buffer, box?: { x: number; y: number; w: number; h: number }, margin = 4): number {
  let count = 0;

  for (let y = 0; y < 360; y++) {
    for (let x = 0; x < 640; x++) {
      const inside =
        box && x >= box.x - margin && x < box.x + box.w + margin && y >= box.y - margin && y < box.y + box.h + margin;

      if (!inside && Math.abs(a[y * 640 + x] - b[y * 640 + x]) > 40) count++;
    }
  }

  return count;
}

beforeAll(() => {
  fs.mkdirSync(path.dirname(footage), { recursive: true });
  const sources = ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2'];
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...sources, '-pix_fmt', 'yuv420p', '-shortest', footage]);
  const data = new Uint8Array(200 * 100 * 4).fill(255);
  fs.writeFileSync(card, encodePng({ width: 200, height: 100, channels: 4, data }));
});

describe('clip on real frames', () => {
  it('validates cleanly', () => {
    expect(new TemplateValidator().validateTemplate(descriptor(true)).errors ?? []).toEqual([]);
  });

  it('keeps the block and the layer inside their boxes, whole at rest', async () => {
    const bare = await render(descriptor(true, false));
    const clipped = await render(descriptor(true));
    const free = await render(descriptor(false));
    const crop = /kc0_e0\]crop=(\d+):(\d+):(\d+):(\d+)/.exec(clipped.commands);

    expect(crop).not.toBeNull();

    const [w, h, x, y] = (crop as RegExpExecArray).slice(1).map(Number);
    const textBox = { x, y, w, h };
    const text = (k: number) => k;
    // The layer section is the last 45 frames (the first section's segment carries one more).
    const layer = (k: number) => bare.frames.length - 45 + k;

    expect(clipped.frames.length).toBe(bare.frames.length);

    // Without the clip the rising text and card show below their boxes early on: the check bites.
    expect(changed(free.frames[text(6)], bare.frames[text(6)], textBox)).toBeGreaterThan(50);
    expect(changed(free.frames[layer(6)], bare.frames[layer(6)], LAYER_BOX)).toBeGreaterThan(50);

    for (let k = 0; k < 45; k++) {
      expect(changed(clipped.frames[text(k)], bare.frames[text(k)], textBox), `text frame ${k}`).toBe(0);
      expect(changed(clipped.frames[layer(k)], bare.frames[layer(k)], LAYER_BOX), `layer frame ${k}`).toBe(0);
    }

    // At rest the clipped and free renders agree everywhere: the text and the card are whole.
    expect(changed(clipped.frames[text(40)], free.frames[text(40)])).toBeLessThan(10);
    expect(changed(clipped.frames[layer(40)], free.frames[layer(40)])).toBeLessThan(10);
    expect(changed(clipped.frames[text(40)], bare.frames[text(40)])).toBeGreaterThan(500);
  }, 600_000);

  it('renders a layer whose box is off the frame as nothing, its leg still consumed', async () => {
    const offFrame = descriptor(true);
    const section = offFrame.sections?.[1] as unknown as { inputs: Array<{ options: Record<string, unknown> }> };
    section.inputs[0].options.clip = { x: 5000, y: 0, w: 100, h: 100 };
    const bare = await render(descriptor(true, false));
    const off = await render(offFrame);
    const layer = (k: number) => bare.frames.length - 45 + k;

    expect(off.frames.length).toBe(bare.frames.length);
    for (const k of [0, 6, 20, 40]) {
      expect(changed(off.frames[layer(k)], bare.frames[layer(k)]), `layer frame ${k}`).toBe(0);
    }
  }, 600_000);
});
