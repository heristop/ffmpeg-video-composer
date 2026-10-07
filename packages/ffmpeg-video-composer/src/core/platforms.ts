// Delivery platform profiles: where a video is going to be posted, and what that implies for it.
//
// One table, pure data, no imports. `global.platform` reads it to pick a default orientation, to warn
// about text hidden under the app's own UI (per-edge safe zones), to lift the default caption above
// that UI, to flag a timeline longer than the platform accepts, and to aim loudness normalisation at
// the platform's playback target. The safe-zone fractions are deliberately generous: an app redesign
// moves its buttons by a few percent, and text that clears the generous zone clears the next layout too.

export type PlatformOrientation = 'portrait' | 'landscape' | 'square';

export interface SafeZone {
  /** Fraction of the frame height covered by the app UI along the top edge. */
  top: number;
  /** Fraction of the frame height covered by the app UI along the bottom edge. */
  bottom: number;
  /** Fraction of the frame width covered by the app UI along the left edge. */
  left: number;
  /** Fraction of the frame width covered by the app UI along the right edge. */
  right: number;
}

export type SafeEdge = keyof SafeZone;

export interface DeliveryPlatform {
  title: string;
  orientation: PlatformOrientation;
  /** Recommended upload frame in pixels (informational: the engine's own presets render the output). */
  frame: { width: number; height: number };
  /** Recommended frame rate. */
  fps: number;
  /** Longest video the platform accepts, in seconds. */
  maxDuration: number;
  /** Playback loudness target: integrated LUFS, accepted ± tolerance (LU), true-peak ceiling (dBTP). */
  loudness: { lufs: number; tolerance: number; truePeak: number };
  safe: SafeZone;
  /** What covers each edge, for warnings ("caption block", "action buttons"). */
  ui: Record<SafeEdge, string>;
}

const PORTRAIT_FRAME = { width: 1080, height: 1920 };
const LANDSCAPE_FRAME = { width: 1920, height: 1080 };
const SQUARE_FRAME = { width: 1080, height: 1080 };
const STREAMING_LOUDNESS = { lufs: -14, tolerance: 2, truePeak: -1 };
const TITLE_SAFE: SafeZone = { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 };
const TITLE_SAFE_UI: Record<SafeEdge, string> = {
  top: 'title-safe margin',
  bottom: 'player controls',
  left: 'title-safe margin',
  right: 'title-safe margin',
};

function feed(title: string, orientation: PlatformOrientation, maxDuration: number): DeliveryPlatform {
  const frames = { portrait: PORTRAIT_FRAME, landscape: LANDSCAPE_FRAME, square: SQUARE_FRAME };

  return {
    title,
    orientation,
    frame: frames[orientation],
    fps: 30,
    maxDuration,
    loudness: STREAMING_LOUDNESS,
    safe: TITLE_SAFE,
    ui: TITLE_SAFE_UI,
  };
}

export const PLATFORMS = {
  tiktok: {
    title: 'TikTok',
    orientation: 'portrait',
    frame: PORTRAIT_FRAME,
    fps: 30,
    maxDuration: 600,
    loudness: STREAMING_LOUDNESS,
    safe: { top: 0.1, bottom: 0.22, left: 0.05, right: 0.14 },
    ui: { top: 'tab bar', bottom: 'caption block', left: 'edge padding', right: 'action buttons' },
  },
  reels: {
    title: 'Instagram Reels',
    orientation: 'portrait',
    frame: PORTRAIT_FRAME,
    fps: 30,
    maxDuration: 90,
    loudness: STREAMING_LOUDNESS,
    safe: { top: 0.08, bottom: 0.2, left: 0.05, right: 0.12 },
    ui: { top: 'header', bottom: 'caption and audio row', left: 'edge padding', right: 'action buttons' },
  },
  shorts: {
    title: 'YouTube Shorts',
    orientation: 'portrait',
    frame: PORTRAIT_FRAME,
    fps: 30,
    maxDuration: 180,
    loudness: STREAMING_LOUDNESS,
    safe: { top: 0.06, bottom: 0.18, left: 0.05, right: 0.12 },
    ui: { top: 'search bar', bottom: 'title and channel row', left: 'edge padding', right: 'action buttons' },
  },
  youtube: { ...feed('YouTube', 'landscape', 43_200), loudness: { lufs: -14, tolerance: 1, truePeak: -1 } },
  x: { ...feed('X', 'landscape', 140), frame: { width: 1280, height: 720 } },
  linkedin: feed('LinkedIn', 'landscape', 600),
  facebook: feed('Facebook feed', 'landscape', 240),
  'square-feed': feed('Square feed post', 'square', 240),
} as const satisfies Record<string, DeliveryPlatform>;

export type PlatformId = keyof typeof PLATFORMS;

export const PLATFORM_ALIASES = {
  ig: 'reels',
  instagram: 'reels',
  'yt-shorts': 'shorts',
  'youtube-shorts': 'shorts',
  twitter: 'x',
} as const satisfies Record<string, PlatformId>;

export type PlatformName = PlatformId | keyof typeof PLATFORM_ALIASES;

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

/** Every accepted `global.platform` value: canonical ids, then aliases. */
export const PLATFORM_NAMES = [...PLATFORM_IDS, ...Object.keys(PLATFORM_ALIASES)] as [PlatformName, ...PlatformName[]];

export interface ResolvedPlatform extends DeliveryPlatform {
  id: PlatformId;
}

/** The profile for a platform id or alias; undefined for anything else (including undefined). */
export function resolvePlatform(name: string | undefined): ResolvedPlatform | undefined {
  if (name === undefined) return undefined;

  const id = Object.hasOwn(PLATFORM_ALIASES, name) ? PLATFORM_ALIASES[name as keyof typeof PLATFORM_ALIASES] : name;

  return Object.hasOwn(PLATFORMS, id) ? { id: id as PlatformId, ...PLATFORMS[id as PlatformId] } : undefined;
}

/** The orientation a descriptor renders at: the authored one, else the platform's, else undefined. */
export function effectiveOrientation(
  global: { orientation?: string; platform?: string } | undefined
): string | undefined {
  return global?.orientation ?? resolvePlatform(global?.platform)?.orientation;
}

/** The single-pass loudnorm filter aimed at the platform's playback target. */
export function platformLoudnorm(platform: DeliveryPlatform): string {
  return `loudnorm=I=${platform.loudness.lufs}:TP=${platform.loudness.truePeak}:LRA=11`;
}

export interface PlatformCatalogEntry extends ResolvedPlatform {
  aliases: string[];
}

/** Every platform with its aliases, for agents choosing `global.platform`. */
export function platformCatalog(): PlatformCatalogEntry[] {
  const aliases = Object.entries(PLATFORM_ALIASES);

  return PLATFORM_IDS.map((id) => ({
    id,
    aliases: aliases.filter(([, target]) => target === id).map(([alias]) => alias),
    ...PLATFORMS[id],
  }));
}
