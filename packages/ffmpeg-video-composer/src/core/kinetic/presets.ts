// Kinetic presets as data: the defaults every block starts from and the one-line description an agent
// reads in the motion catalog. Distances are fractions of the font size, so a preset reads the same at
// any size; springs and curves are motion tokens, resolved like any other easing.

import type { KineticUnit } from './layout';

export interface KineticPresetDefaults {
  description: string;
  unit: KineticUnit;
  /** Seconds between units, keyed by the unit actually used. */
  stagger: Record<KineticUnit, number>;
  ease: string;
  /** Seconds per unit when the ease has no natural duration. */
  duration: number;
  /** Travel as a fraction of the font size. */
  travel: number;
}

const WORD_STAGGER = { line: 0.18, word: 0.07, glyph: 0.035 };

export const KINETIC_PRESET_DEFAULTS: Record<string, KineticPresetDefaults> = {
  cascade: {
    description: 'Words rise into place one after another on a snappy spring.',
    unit: 'word',
    stagger: WORD_STAGGER,
    ease: 'spring(420, 30)',
    duration: 0.5,
    travel: 0.55,
  },
  rise: {
    description: 'Units travel up into place with an expo settle.',
    unit: 'word',
    stagger: WORD_STAGGER,
    ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
    duration: 0.6,
    travel: 0.6,
  },
  drop: {
    description: 'Units fall into place from above and land on a bouncy spring.',
    unit: 'word',
    stagger: WORD_STAGGER,
    ease: 'spring(300, 14)',
    duration: 0.6,
    travel: 0.5,
  },
  slide: {
    description: 'Units slide in from `direction` with an expo settle.',
    unit: 'word',
    stagger: WORD_STAGGER,
    ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
    duration: 0.6,
    travel: 1.2,
  },
  pop: {
    description: 'Each unit springs up from 30% size around its own centre.',
    unit: 'word',
    stagger: { line: 0.2, word: 0.08, glyph: 0.03 },
    ease: 'spring(300, 14)',
    duration: 0.6,
    travel: 0,
  },
  impact: {
    description: 'Each unit slams down from 180% size: a punchy, heavy arrival.',
    unit: 'word',
    stagger: { line: 0.25, word: 0.12, glyph: 0.05 },
    ease: 'spring(600, 40)',
    duration: 0.35,
    travel: 0,
  },
  'tracking-in': {
    description: 'Wide letter-spacing collapses to tight while the line fades in (keynote title).',
    unit: 'glyph',
    stagger: { line: 0, word: 0, glyph: 0 },
    ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
    duration: 1.4,
    travel: 0.45,
  },
  typewriter: {
    description: 'Glyphs appear one by one behind a blinking caret.',
    unit: 'glyph',
    stagger: { line: 0.4, word: 0.18, glyph: 0.05 },
    ease: 'linear',
    duration: 0.04,
    travel: 0,
  },
  scramble: {
    description: 'Glyphs decode from seeded random characters, left to right.',
    unit: 'glyph',
    stagger: { line: 0.2, word: 0.1, glyph: 0.04 },
    ease: 'linear',
    duration: 0.3,
    travel: 0,
  },
  wave: {
    description: 'Glyphs rise in, then bob on a travelling sine wave while the line holds.',
    unit: 'glyph',
    stagger: { line: 0.1, word: 0.06, glyph: 0.03 },
    ease: 'spring(300, 18)',
    duration: 0.6,
    travel: 0.4,
  },
  highlight: {
    description: 'Words cascade in, then a marker sweeps behind the accent words.',
    unit: 'word',
    stagger: WORD_STAGGER,
    ease: 'spring(420, 30)',
    duration: 0.5,
    travel: 0.4,
  },
  counter: {
    description: 'A number rolls from counter.from to counter.to with an expo settle.',
    unit: 'line',
    stagger: { line: 0, word: 0, glyph: 0 },
    ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
    duration: 1.6,
    travel: 0,
  },
  split: {
    description: 'Each line arrives as two halves from opposite sides and locks in the middle.',
    unit: 'word',
    stagger: { line: 0.12, word: 0.04, glyph: 0.02 },
    ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
    duration: 0.7,
    travel: 2,
  },
  fade: {
    description: 'A plain staggered fade, for calm instructional copy.',
    unit: 'word',
    stagger: { line: 0.2, word: 0.06, glyph: 0.025 },
    ease: 'ease-out-cubic',
    duration: 0.5,
    travel: 0,
  },
};

/** The catalog an agent reads: preset → description and defaults. */
export function kineticCatalog(): Array<{ preset: string } & KineticPresetDefaults> {
  return Object.entries(KINETIC_PRESET_DEFAULTS).map(([preset, defaults]) => ({ preset, ...defaults }));
}
