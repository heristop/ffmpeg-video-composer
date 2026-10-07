import type { LayoutSectionRef } from '@/core/layout/sources';
import type { Filter, Section } from '@/core/types';
import type { FxGraphic } from '../../schemas/fx.schemas';
import type { Graphic } from '../../schemas/graphics.schemas';

/** One fx graphic to lower (editor/presets/fx.ts): the element, its window and where it sits. */
export type FxRequest = {
  graphic: FxGraphic;
  at: number;
  until: number | undefined;
  /** Derived seed of the element (global.seed + its path). */
  seed: number;
  /** Index in section.graphics (pad-name prefix). */
  index: number;
  section: Section;
  ctx: SugarContext;
};

/** One stroke graphic (frame, corners, underline) to lower (editor/presets/stroke-graphics.ts). */
export type StrokeRequest = Omit<FxRequest, 'graphic'> & {
  graphic: Extract<Graphic, { type: 'frame' | 'corners' | 'underline' }>;
};

// Context a sugar compiler needs to lower time/space-dependent effects (motion calibrates its
// Ken Burns curve over the clip length and scale). Built once per section by SegmentBuilder.
export type SugarContext = {
  duration: number;
  /** Output scale as 'W:H', e.g. '1280:720'. */
  scale: string;
  fps: number;
  /** True for real footage (project_video/video) so motion advances one output frame per input frame. */
  isVideo: boolean;
  /** `global.platform` (core/platforms.ts): the default caption clears that app's bottom UI. */
  platform?: string;
  /** `global.theme` (resolved per use): subtitle DNA colours may be `$color.*` tokens. */
  theme?: unknown;
  /** Motion inputs for kinetic typography (energy, seeds, text resolution). */
  motion?: KineticSugarContext;
  /** Mask/compositing services (kinetic fills, section layouts); absent = no mask features. */
  masks?: MaskSugarContext;
  /** The template's sections, for layout panes that name another section. */
  sections?: readonly LayoutSectionRef[];
};

export type ExtraInputSource = { url: string; still: boolean } | { clip: string };

export type MaskSugarContext = {
  /** The build has alphamerge (fills); false on an on-device engine built without it. */
  available: boolean;
  /**
   * Registers media as an extra `-i` of this segment under `key` — a URL/path (`still` images are
   * looped) or another section's recorded clip — returning its `input:<key>` sub-graph label, or null
   * when this segment can't take extra inputs. Registering a key twice returns the same label.
   */
  input: (key: string, source: ExtraInputSource) => string | null;
  /** A colour token resolved (variables) and reduced to a filter-option-safe value. */
  color: (color: string) => string;
  /** Compile-time advisory (logged). */
  warn: (message: string) => void;
  /** True when the active FFmpeg build has the filter (device allowlist, host probe). */
  has?: (filter: string) => boolean;
  /**
   * Lowers fx graphics (editor/presets/fx.ts). Only the compile path provides it, so the effect modules stay
   * out of the browser's eager load; without it (validation) fx graphics lower to nothing, as they draw no text.
   */
  effects?: (request: FxRequest) => Filter[];
  /**
   * Lowers stroke graphics (editor/presets/stroke-graphics.ts), compile path only like `effects`; without
   * it they draw nothing.
   */
  strokes?: (request: StrokeRequest) => Filter[] | null;
};

export type KineticSugarContext = {
  energy: number;
  /** Derived seed for an element path inside the section (hash of global.seed and the path). */
  seedFor: (path: string) => number;
  /** Locale pick + variables + fields + section case, i.e. the final text to lay out. */
  resolveText: (text: Record<string, string | undefined>) => string;
};
