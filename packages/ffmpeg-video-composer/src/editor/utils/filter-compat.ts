import type { Filter, ProjectConfig } from '@/core/types';
import type { EngineFeatures } from '@/core/capabilities';
import { usesLgplEngine } from '../../core/encoding';
import { eqValueToLutyuv } from '../presets/looks';
import { DEVICE_FILTERS, DEVICE_LIBRARIES } from './device-filters.generated';

/**
 * What the active FFmpeg build can do. The on-device engine is a `--disable-gpl` LGPL build, so
 * GPL-only filters (`eq`, `boxblur`, …) are absent; the server/web/Node default is GPL-capable.
 * Compatibility rules below key off these flags instead of branching on the codec ad hoc.
 */
export type EngineCapabilities = {
  /** GPL filters available (eq, boxblur, …). False on the on-device LGPL engine. */
  gpl: boolean;
  /** `lut3d` colour-LUT filter available (a standard LGPL filter; present on every normal build). */
  lut3d: boolean;
  /** `colorkey` chroma-key filter available (standard LGPL filter). */
  colorkey: boolean;
  /**
   * drawtext `text_shaping` available: the build links libfribidi, so Arabic/Hebrew lines are reordered
   * (bidi) on top of HarfBuzz shaping. The option only exists in such builds (emitting it elsewhere is
   * an "Option not found" error). Node probes its binary; the device reads its build config; WASM: off.
   */
  textShaping: boolean;
  /** The curated on-device allowlist (generated from common.sh), or null on full GPL/WASM builds
   * where every filter the engine can emit is present. */
  deviceFilters: ReadonlySet<string> | null;
  /** Filters the Node capability probe found absent or broken in the local FFmpeg, or null unprobed. */
  missingFilters: ReadonlySet<string> | null;
};

export type { EngineFeatures } from '@/core/capabilities';

// lut3d/colorkey are standard default-enabled filters present on every backend (host GPL, on-device
// LGPL, the 6.x WASM core), so they're advertised as available everywhere; the web e2e confirms the
// WASM core and these flags can be flipped if a filter ever turns out absent (the FILTER_COMPAT rules
// below then drop the effect with a warning rather than aborting the render). text_shaping follows the
// real build: a probed binary's own configure flags (Node), else the device build config (LGPL engine),
// else off — the WASM core and an unprobed host may lack libfribidi.
export function engineCapabilities(config: ProjectConfig, features: EngineFeatures | null = null): EngineCapabilities {
  const device = usesLgplEngine(config);

  return {
    gpl: !device && (features?.gpl ?? true),
    lut3d: features?.missingFilters?.has('lut3d') !== true,
    colorkey: true,
    textShaping: features ? features.fribidi : device && DEVICE_LIBRARIES.has('fribidi'),
    deviceFilters: device ? DEVICE_FILTERS : null,
    missingFilters: features?.missingFilters ?? null,
  };
}

/**
 * True when the active build has the filter: every filter on a full build, the allowlist on device, and
 * never one the Node capability probe found missing (masks then fall back to solid text, for instance).
 */
export function hasFilter(caps: EngineCapabilities, filter: string): boolean {
  if (caps.missingFilters?.has(filter) === true) return false;

  return caps.deviceFilters === null || caps.deviceFilters.has(filter);
}

/**
 * A platform compatibility rule: when `match` holds for a filter under the current engine
 * capabilities, the filter is replaced by `remap`'s result (or dropped when it returns null).
 * Adding support for another unavailable filter is one entry here.
 */
export type FilterCompatRule = {
  key: string;
  match: (filter: Filter, caps: EngineCapabilities) => boolean;
  remap: (filter: Filter) => Filter | null;
};

export const FILTER_COMPAT: FilterCompatRule[] = [
  {
    // The GPL `eq` filter is absent on the LGPL engine — rewrite it to an equivalent lutyuv LUT.
    key: 'eq-to-lutyuv',
    match: (filter, caps) => filter.type === 'eq' && Boolean(filter.value) && !caps.gpl,
    remap: (filter) => ({ ...filter, type: 'lutyuv', value: eqValueToLutyuv(String(filter.value)) }),
  },
  {
    // A filter the local FFmpeg lacks or cannot run (Node capability probe, e.g. drawtext on a build
    // without libfreetype): dropped with a warning rather than failing the render.
    key: 'drop-missing-on-host',
    match: (filter, caps) => caps.missingFilters?.has(filter.type) === true,
    remap: () => null,
  },
  {
    // Any filter still absent from the device allowlist after rewrites has no LGPL equivalent:
    // drop it (FilterManager degrades to the no-op `null` filter with a warning) instead of letting
    // the render die on-device with "No such filter".
    key: 'drop-absent-on-device',
    match: (filter, caps) => caps.deviceFilters !== null && !caps.deviceFilters.has(filter.type),
    remap: () => null,
  },
];

/**
 * Applies every matching compatibility rule to a filter, in registry order. Returns the (possibly
 * rewritten) filter, or null when a rule drops it entirely (the filter is unavailable and has no
 * equivalent on this engine).
 */
export function applyFilterCompat(filter: Filter, caps: EngineCapabilities): Filter | null {
  let resolved: Filter | null = filter;

  for (const rule of FILTER_COMPAT) {
    if (resolved && rule.match(resolved, caps)) {
      resolved = rule.remap(resolved);
    }
  }

  return resolved;
}

/**
 * Every filter name the engine itself can write into a command, beyond the section's authored
 * filters: sugar lowering (looks/grade/motion/captions/text blocks), the map/overlay graphs,
 * scaling, colour metadata and the assembly/audio passes. The LGPL audit test
 * (tests/lgpl-filter-audit.test.ts) cross-checks this inventory against the on-device build's
 * --enable-filter list; extend it whenever a preset or manager starts emitting a new filter.
 */
export const ENGINE_EMITTED_FILTERS = [
  // scaling / framing (SegmentBuilder.prependScaleFilters, input-sources.ts scale/pad chains, layersToFilters)
  'scale',
  'crop',
  'pad',
  'setsar',
  'drawbox',
  // text & reveals (captions.ts, text-blocks.ts, text-blocks-helpers.ts, FilterManager fade shortcuts,
  // input-sources.ts overlay entrance)
  'drawtext',
  'fade',
  // drop-path no-op (FilterManager.addFilter): a compat rule with no device equivalent degrades to
  // this rather than emitting a filter the engine will die on.
  'null',
  // looks / grade (looks.ts LOOK_TABLE + gradeToFilters, post-compat): `eq` is GPL-only and gets
  // rewritten to `lutyuv` under the LGPL engine (see FILTER_COMPAT below)
  'eq',
  'lutyuv',
  'hue',
  'colorbalance',
  'gblur',
  'noise',
  'curves',
  'lut3d',
  // stylized looks (Phase 4 LOOK_TABLE rows: duotone/sketch/glitch)
  'rgbashift',
  'edgedetect',
  // motion (MOTION_HANDLERS in looks.ts) + gradient/animation overlay opacity fade
  'zoompan',
  'rotate',
  'hflip',
  'vflip',
  'fps',
  'colorchannelmixer',
  // maps / overlays / chroma key (MapManager), gradient lavfi source (input-sources.ts), speed
  // (FormatterManager's setpts, authored via section.filters)
  'overlay',
  'split',
  // masks (kinetic-fill.ts): a drawtext mask's luma copied into a gradient/texture fill's alpha; the
  // mask is stretched to full range with lutyuv (listed above) and sized with pad/crop for wipes
  'alphamerge',
  'colorkey',
  'gradients',
  'setpts',
  // fx vignette-breathe (fx-vignette.ts): the breathing falloff mask
  'vignette',
  // colour metadata (core/encoding.ts buildColorMetadataFilter, appended as every segment's final node)
  'setparams',
  // footage edits (footage-lowering.ts: clip range trim, freeze loop, the audio concat of ramp pieces
  // and freeze silences) and the blur fit subgraph (reframe.ts: split/scale/crop/gblur/lutyuv/overlay,
  // all listed above). tpad/apad/adelay are deliberately not used: they are absent on device.
  'trim',
  'loop',
  'concat',
  // assembly & audio (transition-graph.ts, MusicComposer, audio-fade.ts): atempo is FormatterManager's
  // audio counterpart to setpts (authored via section.filters); asplit/sidechaincompress/amix drive the
  // ducking mix; loudnorm/dynaudnorm the normalize pass; afftdn the noise-reduction pass
  'xfade',
  'acrossfade',
  'format',
  'color',
  'atrim',
  'asetpts',
  'atempo',
  'afade',
  'volume',
  'aformat',
  'amix',
  'asplit',
  'sidechaincompress',
  'afftdn',
  'loudnorm',
  'dynaudnorm',
  'anullsrc',
  'aevalsrc',
  // footage edits (editor/footage/): kept windows (trim/atrim + concat) and cutaways (overlay, volume,
  // amix, anullsrc, aformat above). The HDR tone-map (zscale/tonemap) and silencedetect are host-only:
  // the director requests them only through the Node FootageAnalyzer, never on the device engine.
  'trim',
  'concat',
  // section audio effect presets (audio-fade.ts AUDIO_EFFECT_FILTERS: echo/telephone/muffled) —
  // `telephone` chains highpass,lowpass in one -af value; listed as individual filter names since
  // this string isn't a FilterManager filter object and so isn't FILTER_COMPAT-routed.
  'aecho',
  'highpass',
  'lowpass',
  // voice clean-up presets (core/audio/voice-presets.ts VOICE_PRESET_STAGES, subset-filtered on device)
  'acompressor',
  'agate',
  'alimiter',
  'equalizer',
  // sound-effect placement (editor/utils/sfx-mix.ts): adelay, else an anullsrc lead joined by concat
  'adelay',
  'concat',
] as const;
