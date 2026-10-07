// Voice clean-up presets for a section's recorded sound (`options.voice`), as data: each preset is an
// ordered list of audio filters lowered onto the section `-af` chain. A stage whose filter the active
// FFmpeg build lacks (the on-device allowlist, see editor/utils/filter-compat.ts) is skipped, so a
// preset degrades to the subset the engine can run instead of failing the render. Pure.

export const VOICE_PRESETS = ['clean', 'broadcast', 'warm', 'rumble-cut', 'room-gate'] as const;

export type VoicePreset = (typeof VOICE_PRESETS)[number];

export interface VoiceStage {
  filter: string;
  args: string;
}

// -1 dBFS sample ceiling, auto-level off (it would push the voice up to the ceiling) and the lookahead
// delay compensated so the voice stays in sync with the picture.
const LIMITER: VoiceStage = { filter: 'alimiter', args: 'limit=0.891:level=0:latency=1' };

function stage(filter: string, args: string): VoiceStage {
  return { filter, args };
}

function bell(frequency: number, gain: number, octaves = 1): VoiceStage {
  return stage('equalizer', `f=${frequency}:t=o:w=${octaves}:g=${gain}`);
}

export const VOICE_PRESET_STAGES: Record<VoicePreset, readonly VoiceStage[]> = {
  // Rumble out, light denoise, less box (250 Hz), more presence (3 kHz), gentle 2.5:1 levelling, ceiling.
  clean: [
    stage('highpass', 'f=80'),
    stage('afftdn', 'nr=8:nf=-45'),
    bell(250, -3),
    bell(3000, 3),
    stage('acompressor', 'threshold=0.125:ratio=2.5:attack=20:release=250:makeup=1.5'),
    LIMITER,
  ],
  // Radio voice: tighter band, stronger presence and 4:1 compression with more make-up gain.
  broadcast: [
    stage('highpass', 'f=90'),
    stage('afftdn', 'nr=10:nf=-45'),
    bell(250, -4),
    bell(3500, 5),
    stage('acompressor', 'threshold=0.063:ratio=4:attack=10:release=200:makeup=2.5'),
    LIMITER,
  ],
  // A broad low-mid lift (a shelf-like two-octave bell at 200 Hz) and softened highs, gently levelled.
  warm: [
    stage('highpass', 'f=70'),
    bell(200, 3, 2),
    bell(7000, -2, 2),
    stage('acompressor', 'threshold=0.125:ratio=2:attack=30:release=300:makeup=1.3'),
    LIMITER,
  ],
  // Handling noise, wind and traffic rumble only.
  'rumble-cut': [stage('highpass', 'f=100')],
  // Closes between phrases so room tone and reverb tails drop by about 20 dB.
  'room-gate': [stage('highpass', 'f=80'), stage('agate', 'threshold=0.03:ratio=3:attack=5:release=250:range=0.1')],
};

/** Every filter a voice preset can emit (the LGPL audit and the device allowlist cover these). */
export const VOICE_FILTERS: readonly string[] = [
  ...new Set(Object.values(VOICE_PRESET_STAGES).flatMap((stages) => stages.map((entry) => entry.filter))),
];

/**
 * The preset as `-af` chain entries, keeping only the stages `available` allows (null = every filter is
 * present, the host/WASM case).
 */
export function voiceChain(preset: VoicePreset, available: ReadonlySet<string> | null = null): string[] {
  return VOICE_PRESET_STAGES[preset]
    .filter((entry) => available === null || available.has(entry.filter))
    .map((entry) => `${entry.filter}=${entry.args}`);
}
