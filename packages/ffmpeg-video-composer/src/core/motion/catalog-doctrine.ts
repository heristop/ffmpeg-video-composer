// Genre doctrine: the motion defaults and the do / avoid lists a motion director applies per kind of
// video. An agent picks the genre first, then lets these defaults decide energy, transitions and curves.

export const MOTION_GENRES = [
  'product-launch',
  'explainer',
  'social-hook',
  'cinematic-trailer',
  'calm-tutorial',
] as const;

export type MotionGenre = (typeof MOTION_GENRES)[number];

export interface GenreDoctrine {
  summary: string;
  defaults: {
    /** global.motion.energy */
    energy: number;
    /** One primary boundary, a few accents for key moments. */
    transition: { primary: string; accents: string[]; duration: number };
    /** Ease tokens by role. */
    ease: { hero: string; support: string; exit: string; camera: string };
    /** Typical section length range, seconds. */
    beat: [number, number];
  };
  do: string[];
  avoid: string[];
}

export const GENRE_DOCTRINE: Record<MotionGenre, GenreDoctrine> = {
  'product-launch': {
    summary: 'Confident and premium: smooth curves, one idea per beat, the product revealed in sequence.',
    defaults: {
      energy: 0.9,
      transition: { primary: 'push-left', accents: ['zoom-through', 'iris'], duration: 0.6 },
      ease: { hero: '$expo', support: '$smooth', exit: 'ease-in-cubic', camera: 'ease-in-out-sine' },
      beat: [2, 6],
    },
    do: [
      'Use smooth expo / bezier curves; springs only at high damping ($snappy).',
      'Reveal features sequentially through the back half of each beat (delays 0.3 / 1.3 / 2.3 s).',
      'Tracking-in or rise for the product name; one underline or panel as emphasis.',
      'A slow push-in on the product reveal; hold the final lockup 1.5 s or more.',
    ],
    avoid: [
      'Overshoot springs ($bouncy, $wobbly, ease-out-back) and pop on headlines.',
      'Ambient breathing: handheld shake, wave or constant drift on every beat.',
      'More than one zoom-through, flash or impact in the whole video.',
    ],
  },
  explainer: {
    summary: 'Clear and paced for reading: every move points at the idea being explained.',
    defaults: {
      energy: 0.8,
      transition: { primary: 'push-left', accents: ['swipe-left', 'fade'], duration: 0.5 },
      ease: { hero: '$snappy', support: '$smooth', exit: 'ease-in-cubic', camera: 'ease-in-out-sine' },
      beat: [3, 7],
    },
    do: [
      'One concept per section; highlight the key word, underline the key line.',
      'Use counter for numbers and corners or frame to focus on a stat; a bars-chart to compare a few values.',
      'A progress bar across a multi-step walkthrough; a kicker lower third to label the topic.',
      'Hold every line 0.4 s + words / 3.5 s after it lands.',
    ],
    avoid: [
      'Scramble or impact on body copy.',
      'Camera moves that fight the reading direction.',
      'Exits on every line.',
    ],
  },
  'social-hook': {
    summary: 'Fast and punchy: the first second sells, cuts land on the beat.',
    defaults: {
      energy: 1.3,
      transition: { primary: 'cut', accents: ['zoom-through', 'swipe-left'], duration: 0.35 },
      ease: { hero: '$snappy', support: '$bouncy', exit: 'ease-in-cubic', camera: 'ease-out-expo' },
      beat: [0.8, 3],
    },
    do: [
      'Hook in the first 0.5 s: impact or pop with a camera hit and a flash or a glitch.',
      'Whip transitions on the beat; a kinetic trail on the punch word.',
      'Cut on the beat; keep sections short and vary their length.',
      'Big type, one or two words per beat, accents in a brand colour.',
    ],
    avoid: ['Slow fades and long dissolves.', 'Sections over 3 s without a new arrival.', 'Small body copy.'],
  },
  'cinematic-trailer': {
    summary: 'Tension and release: letterbox, slow camera, titles that tighten in, dips to black.',
    defaults: {
      energy: 1,
      transition: { primary: 'fadeblack', accents: ['cut', 'iris'], duration: 0.7 },
      ease: { hero: '$expo', support: '$smooth', exit: 'ease-in-cubic', camera: 'ease-in-out-sine' },
      beat: [1.5, 6],
    },
    do: [
      'Bars on title beats, tracking-in titles, a slow push-in or handheld sway.',
      'Alternate long held beats with short cut beats (slowest ≥ 3× fastest).',
      'Save a flash or camera hit for the climax.',
      'Open a beat with a focus rack (direction in) under a tracking-in title.',
    ],
    avoid: [
      'Playful presets (pop, wave, drop).',
      'Bright flat backgrounds.',
      'Busy multi-block beats.',
      'Glitch and whip transitions (they break the tension).',
    ],
  },
  'calm-tutorial': {
    summary: 'Quiet and legible: fades and rises, gentle drifts, nothing competes with the instruction.',
    defaults: {
      energy: 0.6,
      transition: { primary: 'fade', accents: ['push-left'], duration: 0.5 },
      ease: { hero: '$gentle', support: '$smooth', exit: 'ease-in-out-sine', camera: 'ease-in-out-sine' },
      beat: [3, 8],
    },
    do: [
      'fade or rise by line; step numbers with pop at low energy.',
      'A drift camera keeps a long hold alive without distracting.',
      'Lower thirds for names and steps (clean-bar or side-rule); a progress bar for the steps.',
    ],
    avoid: [
      'Flash, glitch, impact, scramble and camera hits.',
      'Zoom-through or swipe transitions.',
      'Exits that rush the read.',
    ],
  },
};
