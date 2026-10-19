import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { lookToFilters, gradeToFilters } from '@/editor/presets/looks';
import { LOOK_PRESETS } from '@/schemas/effects.schemas';
import {
  ENGINE_EMITTED_FILTERS,
  FILTER_COMPAT,
  applyFilterCompat,
  type EngineCapabilities,
} from '@/editor/utils/filter-compat';
import { parseEnabledFilters, parseEnabledLibraries } from '../scripts/capability-sources';
import { DEVICE_FILTERS, DEVICE_LIBRARIES } from '@/editor/utils/device-filters.generated';
import { KineticBlockSchema, type KineticBlock } from '@/schemas/kinetic.schemas';
import { kineticToFilters } from '@/editor/presets/kinetic';
import { layoutToFilters } from '@/editor/presets/layout';
import type { Filter } from '@/core/types';
import { VOICE_FILTERS, VOICE_PRESETS, voiceChain } from '@/core/audio/voice-presets';
import { sfxGraph } from '@/editor/utils/sfx-mix';
import { REGISTERED_FX, lowerFx } from '@/editor/presets/fx';
import { lowerShape } from '@/editor/presets/shape-draw';
import { lowerStroke } from '@/editor/presets/stroke-graphics';
import { FX_DOCS } from '@/schemas/fx-docs';
import { layerKeyframes } from '@/editor/presets/layer-keyframes';
import { DESIGNED_TRANSITIONS, designedTransitionGraph } from '@/core/motion/transitions';

const here = path.dirname(fileURLToPath(import.meta.url));
const commonSh = fs.readFileSync(path.resolve(here, '../../../scripts/ffmpeg/common.sh'), 'utf8');

// deviceFilters: null here is deliberate — this audit probes rewrite rules only (e.g. eq→lutyuv);
// the drop-absent-on-device rule is out of scope (it would trivially "cover" every filter by
// dropping it, defeating the point of asserting engine-emitted filters land on a real device filter).
const lgplCaps: EngineCapabilities = {
  gpl: false,
  lut3d: true,
  colorkey: true,
  textShaping: false,
  deviceFilters: null,
  missingFilters: null,
};

function isDeviceSafe(filterType: string, enabled: Set<string>): boolean {
  if (enabled.has(filterType)) {
    return true;
  }

  // Not in the build list: acceptable only if a compat rule rewrites it to an enabled filter (or
  // deliberately drops it) under LGPL capabilities.
  const resolved = applyFilterCompat({ type: filterType, value: 'x=1' }, lgplCaps);

  if (resolved === null) {
    return true;
  }

  return resolved.type !== filterType && enabled.has(resolved.type);
}

describe('LGPL device filter audit', () => {
  let enabled: Set<string>;

  beforeAll(() => {
    enabled = parseEnabledFilters(commonSh);
  });

  // Animated HTML cards enter FFmpeg as one animated PNG overlaid like any layer: no new filter, but the
  // apng demuxer and decoder must be in the device build.
  it('animated html cards decode on device', () => {
    const listed = (kind: string) =>
      new Set((new RegExp(`--enable-${kind}=([^\\s\\\\]+)`).exec(commonSh)?.[1] ?? '').split(','));

    expect(listed('demuxer').has('apng')).toBe(true);
    expect(listed('decoder').has('apng')).toBe(true);
    expect(enabled.has('overlay')).toBe(true);
  });

  it('every look preset lowers to device-safe filters', () => {
    for (const look of LOOK_PRESETS) {
      for (const filter of lookToFilters(look)) {
        expect(isDeviceSafe(filter.type, enabled), `look "${look}" emits "${filter.type}"`).toBe(true);
      }
    }
  });

  it('a full grade lowers to device-safe filters', () => {
    const fullGrade = {
      brightness: 0.02,
      contrast: 1.1,
      saturation: 1.1,
      gamma: 0.98,
      hue: 10,
      blur: 0.5,
      curvesPreset: 'vintage',
      colorBalance: { shadows: { r: 0.05 } },
    };

    for (const filter of gradeToFilters(fullGrade as never)) {
      expect(isDeviceSafe(filter.type, enabled), `grade emits "${filter.type}"`).toBe(true);
    }
  });

  it('every filter the engine declares it can emit is device-safe', () => {
    for (const filterType of ENGINE_EMITTED_FILTERS) {
      expect(isDeviceSafe(filterType, enabled), `engine emits "${filterType}"`).toBe(true);
    }
  });

  it('every voice preset keeps its full chain on device', () => {
    for (const filter of VOICE_FILTERS) {
      expect(enabled.has(filter), `voice presets emit "${filter}"`).toBe(true);
    }

    for (const preset of VOICE_PRESETS) {
      expect(voiceChain(preset, DEVICE_FILTERS)).toEqual(voiceChain(preset));
    }
  });

  it('the sound-effect mix only emits device filters', () => {
    const placements = [
      { id: 'hit' as const, file: 'hit.m4a', start: 1.5, trim: 0, volume: 0.7 },
      { id: 'riser' as const, file: 'riser.m4a', start: 0, trim: 0.5, volume: 0.5 },
    ];
    const channelConfig = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
    const { graph } = sfxGraph({
      placements,
      firstInput: 2,
      channelConfig,
      sampleRate: 48000,
      deviceFilters: DEVICE_FILTERS,
    });
    const names = [...graph.matchAll(/(?:^|[\],;]\s*)([a-z0-9_]+)=/g)].map((match) => match[1]);

    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      expect(enabled.has(name), `sfx mix emits "${name}"`).toBe(true);
    }
  });

  it('compat rules rewrite to filters that exist on device', () => {
    for (const rule of FILTER_COMPAT) {
      const probe = rule.remap({ type: 'eq', value: 'contrast=1.1' });

      if (probe === null) {
        continue;
      }

      expect(enabled.has(probe.type), `rule "${rule.key}" remaps to "${probe.type}"`).toBe(true);
    }
  });

  it('device-filters.generated.ts matches common.sh', () => {
    expect(new Set(DEVICE_FILTERS)).toEqual(parseEnabledFilters(commonSh));
    expect(new Set(DEVICE_LIBRARIES)).toEqual(parseEnabledLibraries(commonSh));
  });

  it('links libfribidi on device (drawtext text_shaping) alongside harfbuzz/freetype', () => {
    expect(DEVICE_LIBRARIES.has('fribidi')).toBe(true);
    expect(DEVICE_LIBRARIES.has('harfbuzz')).toBe(true);
  });

  it('mask and layout sub-graphs lower to device-safe filters only', () => {
    const block = KineticBlockSchema.parse({
      text: { en: 'Shine' },
      preset: 'cascade',
      effect: { shadow: true },
      fill: { gradient: { stops: ['#f00', '#0f0', '#00f'] }, sweep: { every: 2 } },
    });
    const env = { width: 640, height: 360, fps: 25, duration: 2, prefix: 'k_', color: (c: string) => c };
    const fill = kineticToFilters(block, {
      width: 640,
      height: 360,
      fps: 25,
      duration: 2,
      seed: 1,
      energy: 1,
      text: 'Shine',
      fill: env,
    });
    const layouts = [
      { type: 'split', sources: ['a.png', 'b.mp4', '#ff0000'], divider: {} },
      { type: 'before-after', before: 'a.png', after: 'b.mp4', wipe: { at: 0.5, direction: 'up' }, divider: {} },
    ].flatMap((layout) =>
      layoutToFilters(layout as never, {
        ...env,
        self: 'x',
        sections: [],
        input: (key: string) => `input:${key}`,
      })
    );
    const types = (filters: Filter[]): string[] =>
      filters.flatMap((f) => (f.graph ? f.graph.flatMap((chain) => types(chain.filters)) : [f.type]));

    for (const type of types([...fill, ...layouts])) {
      expect(enabled.has(type), `mask/layout emits "${type}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], type).toContain(type);
    }
  });

  // LAYER_KEYFRAMES_AUDIT: a layer input with every keyframe track (and every static leg option and a fade
  // entrance next to them) lowers to device filters only, in both the turned and the unturned legs.
  it('layer keyframe tracks lower to device-safe filters', () => {
    const tracks = {
      x: [{ v: '-40' }, { t: 0.5, v: '+0', ease: 'spring(300, 14)' }],
      y: [{ v: 0 }, { t: 1, v: 20 }],
      scale: [{ v: 0 }, { t: 0.4, v: 1.2, ease: 'ease-out-back' }, { t: 0.6, v: 1 }],
      scaleX: [{ v: 1 }, { t: 1, v: 0 }, { t: 1.2, v: 1 }],
      scaleY: [{ v: 1 }, { t: 0.2, v: 0.8 }],
      opacity: [{ v: 0 }, { t: 0.3, v: 1 }],
    };
    const base = { position: '10:20', scale: '200:100', flip: 'horizontal', opacity: 0.8, motion: 'fade' } as const;
    const legs = [
      layerKeyframes({ ...base, fit: 'contain', animate: tracks }, 25),
      layerKeyframes({ ...base, origin: 'bottom', animate: { ...tracks, rotate: [{ v: -60 }, { t: 1, v: 20 }] } }, 25),
      layerKeyframes({ ...base, rotation: 15, animate: { scale: tracks.scale } }, 25),
    ].flatMap((plan) => plan.legFilters);
    const names = legs.map((filter) => filter.split('=')[0]);

    expect(new Set(names)).toEqual(
      new Set(['fps', 'scale', 'setsar', 'format', 'pad', 'hflip', 'rotate', 'colorchannelmixer', 'fade'])
    );

    for (const name of names) {
      expect(enabled.has(name), `layer keyframes emit "${name}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], name).toContain(name);
    }
  });

  // FX_AUDIT: every registered fx primitive, on every target shape, animated and reduced, with and without
  // its optional filters (the device fallbacks), lowers to device filters only.
  it('every fx primitive lowers to device-safe filters', () => {
    const kinetic = [KineticBlockSchema.parse({ text: { en: 'Shine' }, preset: 'rise' })];
    const targets = ['frame', 'text:0', { x: 40, y: 30, w: 300, h: 200, radius: 24 }, { x: 0, y: 0, w: 200, h: 100 }];
    const types = (filters: Filter[]): string[] =>
      filters.flatMap((f) => (f.graph ? f.graph.flatMap((chain) => types(chain.filters)) : [f.type]));
    const lowered = REGISTERED_FX.flatMap((effect) =>
      targets.flatMap((target) =>
        [0, 1].flatMap((energy) =>
          [true, false].flatMap((full) => {
            const graphic = { type: 'fx', effect, target } as never;
            const section = { name: 's', type: 'color_background', kinetic, graphics: [graphic] } as never;
            const ctx = {
              duration: 3,
              scale: '640:360',
              fps: 25,
              isVideo: false,
              motion: { energy, seedFor: () => 1, resolveText: () => 'Shine' },
              masks: {
                available: true,
                input: (key: string) => `input:${key}`,
                color: (c: string) => c,
                warn: () => undefined,
                has: (filter: string) => full || DEVICE_FILTERS.has(filter),
              },
            };

            return lowerFx({ graphic, at: 0.2, until: undefined, seed: 3, index: 0, section, ctx });
          })
        )
      )
    );

    // Ambient primitives whose reduced-motion form is "absent…" (from their intent) lower to nothing at energy 0.
    const absent = REGISTERED_FX.filter((effect) => FX_DOCS[effect].intent.reduced.startsWith('absent')).length;

    expect(lowered.length).toBe((REGISTERED_FX.length * 4 - absent * 2) * targets.length);

    for (const type of types(lowered)) {
      expect(enabled.has(type), `fx emits "${type}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], type).toContain(type);
    }
  });

  // TRANSITION_AUDIT: every designed transition (the drip's silhouettes and masks included) lowers to device
  // filters only, on its default curve and on a spring.
  it('every designed transition lowers to device-safe filters', () => {
    const graphs = DESIGNED_TRANSITIONS.flatMap((type) =>
      [undefined, 'spring(300, 26, 1, 0)'].map((ease) =>
        designedTransitionGraph({
          type,
          ease,
          color: '#F96F99',
          left: 'vs0',
          right: 'vs1',
          out: 'v0',
          id: 'dt0',
          offset: 2,
          duration: 0.8,
          width: 640,
          height: 360,
          fps: 25,
        })
      )
    );
    const names = new Set(
      graphs.flatMap((graph) => [...graph.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)].map((m) => m[1]))
    );

    expect(names).toContain('gradients');
    expect(names).toContain('alphamerge');

    for (const name of names) {
      expect(enabled.has(name), `designed transitions emit "${name}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], name).toContain(name);
    }
  });

  // STROKE_AUDIT: the v2 frame / corners / underline (rounded arc and cap sprites, shadows, every trace and
  // exit) and the path graphic lower to device filters only.
  it('every v2 stroke graphic lowers to device-safe filters', () => {
    const graphics = [
      ...['path', 'split', 'sides', 'fade'].flatMap((trace) =>
        ['fade', 'retract', 'expand'].map((exit) => ({ type: 'frame', trace, exit, radius: 12, contrast: 'shadow' }))
      ),
      ...['together', 'clockwise', 'fade'].flatMap((trace) =>
        ['fade', 'retract', 'expand'].map((exit) => ({ type: 'corners', trace, exit, radius: 8, target: 'layer:0' }))
      ),
      ...['fade', 'retract'].map((exit) => ({ type: 'underline', caps: 'round', exit, color: '#FF8AAE@0.8' })),
      // PATH_AUDIT: the path graphic (reveal lut steps, held trim, cap and head riders, every exit).
      ...['fade', 'retract', 'none'].map((exit) => ({
        type: 'path',
        points: [
          [40, 300],
          [200, 120],
          [400, 260],
        ],
        smooth: true,
        head: { size: 14, color: '#FFF685' },
        exit,
      })),
      { type: 'path', shape: { type: 'arc', cx: 0.5, cy: 0.5, r: 0.3, sweep: 300 }, target: 'layer:0', to: 0.75 },
      { type: 'path', d: 'M10 10 C100 0 200 100 300 40', dash: [12, 8], caps: 'butt', color: '#FF8AAE@0.6' },
    ];
    const types = (filters: Filter[]): string[] =>
      filters.flatMap((f) => (f.graph ? f.graph.flatMap((chain) => types(chain.filters)) : [f.type]));
    const lowered = graphics.flatMap((graphic, index) => {
      const section = { name: 's', type: 'video', options: { layers: [{ x: 100, y: 80, w: 300, h: 200 }] } } as never;
      const ctx = {
        duration: 3,
        scale: '640:360',
        fps: 25,
        isVideo: true,
        masks: {
          available: true,
          input: (key: string) => `input:${key}`,
          color: (c: string) => c,
          warn: () => undefined,
        },
      };

      return lowerStroke({ graphic, at: 0.2, until: 2, seed: 3, index, section, ctx } as never) ?? [];
    });
    const emitted = new Set(types(lowered));

    expect(emitted).toContain('overlay');
    expect(emitted).toContain('fade');
    expect(emitted).toContain('lutyuv');
    expect(emitted).toContain('alphamerge');

    for (const type of emitted) {
      expect(enabled.has(type), `stroke graphics emit "${type}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], type).toContain(type);
    }
  });

  // SHAPE_AUDIT: the shape graphic (default fade, every layer track and an origin, a gradient, a baked
  // outline, a drawn-on outline over the fill) lowers to device filters only.
  it('the shape graphic lowers to device-safe filters', () => {
    const types = (filters: Filter[]): string[] =>
      filters.flatMap((f) => (f.graph ? f.graph.flatMap((chain) => types(chain.filters)) : [f.type]));
    const shapes = [
      { type: 'shape', preset: { type: 'star' } },
      {
        type: 'shape',
        preset: { type: 'blob', seed: 2 },
        gradient: { from: '#9298fb', to: '#f96f99', shape: 'radial' },
        stroke: { width: 4 },
        origin: 'bottom',
        animate: {
          x: [{ v: '-40' }, { t: 0.5, v: '+0', ease: 'spring(300, 14)' }],
          scale: [{ v: 0 }, { t: 0.4, v: 1.2, ease: 'ease-out-back' }, { t: 0.6, v: 1 }],
          scaleX: [{ v: 1 }, { t: 1, v: 0.8 }],
          rotate: [{ v: -30 }, { t: 1, v: 0 }],
          opacity: [{ v: 0 }, { t: 0.3, v: 1 }],
        },
      },
      { type: 'shape', d: 'M0 0 L24 0 L12 20 Z', viewBox: [0, 0, 24, 24], stroke: { draw: true, color: '#ffffff' } },
    ];
    const lowered = shapes.flatMap((graphic, index) => {
      const section = { name: 's', type: 'color_background', options: { duration: 3 } } as never;
      const ctx = {
        duration: 3,
        scale: '640:360',
        fps: 25,
        isVideo: false,
        masks: {
          available: true,
          input: (key: string) => `input:${key}`,
          color: (c: string) => c,
          warn: () => undefined,
        },
      };

      return lowerShape({ graphic, at: 0.2, until: 2, seed: 3, index, section, ctx } as never);
    });
    const emitted = new Set(types(lowered));

    for (const type of ['overlay', 'rotate', 'scale', 'colorchannelmixer', 'lutyuv', 'alphamerge']) {
      expect(emitted, type).toContain(type);
    }

    for (const type of emitted) {
      expect(enabled.has(type), `shape graphics emit "${type}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], type).toContain(type);
    }
  });
});

// Masks and transitions: clip boxes, the bands transition, shaped irises and zoom-through windows lower to
// filters of the on-device build.
describe('LGPL device filter audit: clip boxes, bands, iris shapes, zoom-through windows', () => {
  const BOUNDARY = {
    left: 'vs0',
    right: 'vs1',
    out: 'v0',
    id: 'dt0',
    offset: 2,
    duration: 0.8,
    width: 640,
    height: 360,
    fps: 25,
  };
  const MATTE = { label: '2:v', centre: { x: 300, y: 180 }, scale: 40 };

  function graphFilters(graph: string): string[] {
    return [...graph.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)].map((m) => m[1]);
  }

  it('a clipped kinetic block lowers to device-safe section filters', () => {
    const flat = (filters: Filter[]): string[] =>
      filters.flatMap((f) => (f.graph ? f.graph.flatMap((chain) => flat(chain.filters)) : [f.type]));
    const frame = { width: 640, height: 360, fps: 25, duration: 2, seed: 1, energy: 1, text: 'ONE\nTWO' };
    const block = { text: { en: 'ONE\nTWO' }, preset: 'rise', clip: 'line' } as KineticBlock;
    const types = flat(kineticToFilters(block, frame));

    expect(new Set(types)).toEqual(new Set(['split', 'drawtext', 'crop', 'overlay']));
    for (const type of types) {
      expect(DEVICE_FILTERS.has(type), `emits "${type}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], type).toContain(type);
    }
  });

  it('bands, a star iris and a zoom-through window lower to device-safe assembly filters', () => {
    const graphs = [
      designedTransitionGraph({ ...BOUNDARY, type: 'bands', count: 5, angle: -25 }),
      designedTransitionGraph({ ...BOUNDARY, type: 'iris', shape: 'star', matte: MATTE, ease: 'spring(300, 14)' }),
      designedTransitionGraph({ ...BOUNDARY, type: 'zoom-through', matte: MATTE }),
    ];

    expect(graphFilters(graphs[0])).toEqual(expect.arrayContaining(['color', 'rotate', 'loop', 'overlay']));
    expect(graphFilters(graphs[1])).toEqual(expect.arrayContaining(['xfade', 'alphamerge']));
    expect(graphFilters(graphs[2])).toEqual(expect.arrayContaining(['zoompan', 'alphamerge']));
    // The transition assembly is not a section filter chain (no compat pass): on the build list is enough.
    for (const type of graphs.flatMap(graphFilters)) expect(DEVICE_FILTERS.has(type), `emits "${type}"`).toBe(true);
  });
});
