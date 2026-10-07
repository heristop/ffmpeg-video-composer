import { describe, expect, it } from 'vitest';
import type {
  ProjectBuildInfos,
  ProjectConfig,
  Section,
  TemplateDescriptor,
  TemplateDescriptorGlobal,
} from '@/core/types';
import { planSfx } from '@/editor/utils/sfx-plan';
import { prepareSfxStage } from '@/editor/utils/sfx-stage';
import { cueSeed, resolveCue, soundFileName } from '@/core/audio/sfx-cue';
import { varyPreset } from '@/core/audio/sound-presets';
import { deriveSeed } from '@/core/determinism/hash';
import { renderSoundWav, soundLength } from '@/core/audio/synth/render';
import type { ComposedSound } from '@/core/audio/synth/types';
import type AbstractFilesystem from '@/platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '@/platform/logging/AbstractLogger';

// Composed sounds in the mix: each distinct sound renders once to <build>/sfx/<hash>.wav through the
// platform filesystem, and the mix places it like a library file (anchor and length from the sound).

type Timing = Pick<ProjectBuildInfos, 'durations' | 'transitions'>;

const timing: Timing = { durations: { a: 4, b: 3 }, transitions: [] };

const blip = { layers: [{ source: 'tone' as const, pitch: 880, envelope: { decay: 0.15 } }] } satisfies ComposedSound;
const swell = {
  length: 1.5,
  layers: [
    { source: 'noise' as const, color: 'pink' as const, filter: { type: 'bandpass' as const, from: 300, to: 6000 } },
  ],
} satisfies ComposedSound;

function section(name: string, sfx: unknown[]): Section {
  return { name, type: 'color_background', options: { duration: 4 }, sfx } as Section;
}

describe('resolveCue', () => {
  it('keeps a library id as its bundled file', () => {
    expect(resolveCue({ id: 'riser', at: 1 }, 0)).toMatchObject({
      id: 'riser',
      file: 'riser.m4a',
      duration: 2,
      anchor: 'end',
      defaultVolume: 0.5,
    });
  });

  it('names a composed sound by its content hash, seed included only when it draws random numbers', () => {
    const cue = resolveCue({ sound: blip, at: 0 }, 11);

    expect(cue?.file).toMatch(/^[0-9a-f]{16}\.wav$/);
    expect(cue).toMatchObject({ duration: soundLength(blip), anchor: 'start', defaultVolume: 0.6 });
    expect(cue?.sound).toEqual({ spec: blip, seed: 0 });
    expect(resolveCue({ sound: blip, at: 0 }, 12)?.file).toBe(cue?.file);
    expect(resolveCue({ sound: swell, at: 0 }, 11)?.file).not.toBe(resolveCue({ sound: swell, at: 0 }, 12)?.file);
    expect(resolveCue({ sound: { ...blip, anchor: 'end' }, at: 0 }, 1)?.anchor).toBe('end');
    expect(soundFileName(blip, 0)).toBe(cue?.file);
  });

  it('plays an unvaried preset from its library file and renders a varied one from its recipe', () => {
    expect(resolveCue({ sound: { preset: 'sparkle' }, at: 0 }, 1)).toMatchObject({
      id: 'sparkle',
      file: 'sparkle.m4a',
      anchor: 'start',
    });

    const varied = resolveCue({ sound: { preset: 'riser', pitch: 1.2, length: 1.5 }, at: 0 }, 1);
    const spec = varyPreset('riser', { pitch: 1.2, length: 1.5 });

    expect(varied).toMatchObject({ anchor: 'end', duration: 1.5, defaultVolume: 0.5 });
    expect(varied?.file).toBe(soundFileName(spec, varied?.sound?.seed ?? 0));
    expect(varied?.sound?.spec).toEqual(spec);
  });
});

describe('planSfx with composed sounds', () => {
  it('anchors by the rendered length and seeds from global.seed and the cue path', () => {
    const global: TemplateDescriptorGlobal = { seed: 5, sfx: [{ sound: swell, at: 6, volume: 0.4 }] };
    const segments = [
      section('a', [{ id: 'hit', at: 1 }]),
      section('b', [{ sound: { ...swell, anchor: 'end' }, at: 2 }]),
    ];
    const plan = planSfx(segments, timing, global);
    const riser = plan.find((placement) => placement.start === 4.5);
    const global0 = plan.find((placement) => placement.start === 6);

    expect(plan.map((placement) => placement.start)).toEqual([1, 4.5, 6]);
    expect(riser?.sound?.seed).toBe(deriveSeed(5, 'sections.b.sfx[0]'));
    expect(riser?.volume).toBe(0.6);
    expect(global0?.sound?.seed).toBe(deriveSeed(5, 'global.sfx[0]'));
    expect(global0?.volume).toBe(0.4);
    expect(global0?.file).not.toBe(riser?.file);
    expect(plan[0]).toEqual({ id: 'hit', file: 'hit.m4a', start: 1, trim: 0, volume: 0.7 });
  });
});

interface FakeFs {
  files: Map<string, Uint8Array>;
  fs: AbstractFilesystem;
}

function fakeFilesystem(): FakeFs {
  const files = new Map<string, Uint8Array>();
  const fs = {
    getBuildPath: (dir: string) => Promise.resolve(`/build/${dir}`),
    stat: (path: string) => Promise.resolve(files.has(path)),
    writeFile: (path: string, data: Uint8Array) => {
      files.set(path, data);

      return Promise.resolve();
    },
    resolveBundledSfx: (file: string) => Promise.resolve(`/kit/sfx/${file}`),
  } as unknown as AbstractFilesystem;

  return { files, fs };
}

const logger = { info: () => {}, warn: () => {} } as unknown as AbstractLogger;

describe('prepareSfxStage with composed sounds', () => {
  it('writes each distinct sound once into build/sfx and hands its path to the mix', async () => {
    const { files, fs } = fakeFilesystem();
    const descriptor = {
      global: { musicEnabled: false },
      sections: [
        section('a', [
          { id: 'hit', at: 0.5 },
          { sound: blip, at: 1 },
          { sound: blip, at: 2 },
        ]),
      ],
    } as unknown as TemplateDescriptor;
    const buildInfos = { durations: { a: 4 }, transitions: [] } as unknown as ProjectBuildInfos;
    const stage = await prepareSfxStage({
      descriptor,
      buildInfos,
      config: {} as ProjectConfig,
      filesystem: fs,
      logger,
    });
    const wav = `/build/sfx/${soundFileName(blip, 0)}`;

    expect([...files.keys()]).toEqual([wav]);
    expect(files.get(wav)).toEqual(renderSoundWav(blip, 0));
    expect(stage?.inputArgs).toBe(` -i /kit/sfx/hit.m4a -i ${wav}`);

    const graph = stage?.graph(2, 'aformat=channel_layouts=stereo').graph ?? '';

    expect(graph).toContain('[3:a]asplit=2');
    expect(graph).toContain('adelay=1000|1000');
    expect(graph).toContain('volume=0.6');
  });

  it('reuses a sound already in the build instead of rendering it again', async () => {
    const { files, fs } = fakeFilesystem();
    const wav = `/build/sfx/${soundFileName(blip, 0)}`;
    const stale = Uint8Array.from([1, 2, 3]);

    files.set(wav, stale);
    const descriptor = { global: { sfx: [{ sound: blip, at: 1 }] }, sections: [section('a', [])] };

    await prepareSfxStage({
      descriptor: descriptor as unknown as TemplateDescriptor,
      buildInfos: { durations: { a: 4 }, transitions: [] } as unknown as ProjectBuildInfos,
      config: {} as ProjectConfig,
      filesystem: fs,
      logger,
    });

    expect(files.get(wav)).toBe(stale);
  });
});

describe('cueSeed', () => {
  it('is the seed the mix renders a cue with: global.seed hashed with the cue path', () => {
    const plan = planSfx([section('a', [{ at: 0, sound: swell }]), section('b', [{ at: 0, sound: blip }])], timing, {
      seed: 5,
      sfx: [{ at: 1, sound: swell }],
    } as TemplateDescriptorGlobal);
    const seeds = plan.map((placement) => placement.sound?.seed);

    expect(seeds).toEqual([cueSeed(5, 'sections.a.sfx[0]'), cueSeed(5, 'global.sfx[0]'), 0]);
    expect(cueSeed(5, 'sections.a.sfx[0]')).toBe(deriveSeed(5, 'sections.a.sfx[0]') >>> 0);
  });
});
