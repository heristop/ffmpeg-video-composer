// Speed-ramp presets as data. A preset key sits at a fraction `p` of the trimmed source (`clip.to -
// clip.from`), so one preset fits any clip length; the plan (./plan.ts) converts the keys to output-time
// keys, the shape authored ramps use, before lowering. Speeds are playback rates (2 = twice as fast).

export const SPEED_RAMP_PRESETS = ['hero', 'montage', 'bullet', 'flash-in', 'flash-out'] as const;

export type SpeedRampPreset = (typeof SPEED_RAMP_PRESETS)[number];

export interface PresetRampKey {
  /** Fraction of the trimmed source, 0..1. */
  p: number;
  speed: number;
  /** Curve INTO this key from the previous one (default linear). */
  ease?: string;
}

export interface SpeedRampPresetEntry {
  preset: SpeedRampPreset;
  description: string;
  keys: readonly PresetRampKey[];
}

export const SPEED_RAMP_PRESET_TABLE: Readonly<Record<SpeedRampPreset, SpeedRampPresetEntry>> = {
  hero: {
    preset: 'hero',
    description: 'Real time, eases into 0.3x slow motion through the middle of the clip, eases back to real time.',
    keys: [
      { p: 0, speed: 1 },
      { p: 0.35, speed: 1 },
      { p: 0.45, speed: 0.3, ease: 'ease-in-out' },
      { p: 0.7, speed: 0.3 },
      { p: 0.8, speed: 1, ease: 'ease-in-out' },
    ],
  },
  montage: {
    preset: 'montage',
    description: 'Fast-forward: eases up to 3x for the body of the clip and settles back to real time at the end.',
    keys: [
      { p: 0, speed: 1 },
      { p: 0.1, speed: 3, ease: 'ease-in-out' },
      { p: 0.9, speed: 3 },
      { p: 1, speed: 1, ease: 'ease-in-out' },
    ],
  },
  bullet: {
    preset: 'bullet',
    description: 'Real time, snaps into 0.2x bullet time, then whips out at 2.5x.',
    keys: [
      { p: 0, speed: 1 },
      { p: 0.4, speed: 1 },
      { p: 0.45, speed: 0.2, ease: 'ease-out' },
      { p: 0.6, speed: 0.2 },
      { p: 0.7, speed: 2.5, ease: 'ease-in' },
    ],
  },
  'flash-in': {
    preset: 'flash-in',
    description: 'Opens at 4x and decelerates into real time: an energetic entrance.',
    keys: [
      { p: 0, speed: 4 },
      { p: 0.3, speed: 1, ease: 'ease-out' },
    ],
  },
  'flash-out': {
    preset: 'flash-out',
    description: 'Real time, then accelerates to 4x into the cut: an energetic exit.',
    keys: [
      { p: 0, speed: 1 },
      { p: 0.7, speed: 1 },
      { p: 1, speed: 4, ease: 'ease-in' },
    ],
  },
};

/** Catalog view of the presets (motionCatalog().footage.speedRamps). */
export function speedRampCatalog(): SpeedRampPresetEntry[] {
  return SPEED_RAMP_PRESETS.map((preset) => SPEED_RAMP_PRESET_TABLE[preset]);
}

export interface FootageCatalog {
  fits: Record<string, string>;
  focus: string;
  speedRamps: SpeedRampPresetEntry[];
  fields: string[];
  rules: string[];
}

const FITS: Record<string, string> = {
  cover: 'Fill the frame and crop the overflow (default); options.focus anchors the crop.',
  letterbox: 'Whole picture with bars.',
  blur: 'Whole picture over a blurred, dimmed copy of itself filling the frame (options.fill: blur, dim, zoom).',
  off: 'No scaling: the source already matches the output.',
};

/** Footage editing vocabulary for agents (motionCatalog().footage). */
export function footageCatalog(): FootageCatalog {
  return {
    fits: FITS,
    focus:
      'center | left | right | top | bottom, { x, y } as 0..1 fractions of the source, or keys ' +
      '[{ t, x, y, ease? }] that pan the cover crop over time.',
    speedRamps: speedRampCatalog(),
    fields: [
      'options.fit',
      'options.fill { blur, dim, zoom }',
      'options.focus',
      'options.clip { from, to } (source seconds)',
      'options.speedRamp (preset or [{ at, speed, ease? }] in section seconds)',
      'options.rampAudio (stretch | mute)',
      'options.freeze [{ at, hold, flash?, audio? }]',
    ],
    rules: [
      'clip.from / clip.to are SOURCE seconds; every other footage time (ramp keys, freeze at, focus t) is ' +
        'section time and takes time references ("beat:8", "cue:drop", "50%").',
      'A ramp or freeze changes the section length: a project_video lasts its edited length (capped by ' +
        'options.duration); a video section renders min(options.duration, edited length).',
      'Speeds between 0.25x and 4x read cleanly; outside that frames visibly repeat or skip (no interpolation).',
      'Land a freeze with flash: true on a beat ("beat:12") for an impact frame; keep holds under 1.5 s.',
      'Use fit "blur" for portrait clips in landscape (and back) instead of letterbox bars.',
    ],
  };
}
