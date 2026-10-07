// The lavfi building blocks the sound-effect recipes share (gen-sfx.ts and gen-sfx-recipes-*.ts).
export const RATE = 48000;

export interface SfxRecipe {
  id: string;
  /** A lavfi filtergraph ending in the label [a]. */
  graph: string;
}

export const noise = (d: number, color: string, seed: number, amp = 0.8): string =>
  `anoisesrc=d=${d}:c=${color}:r=${RATE}:a=${amp}:s=${seed}`;
export const tone = (d: number, expr: string): string => `aevalsrc='${expr}':s=${RATE}:d=${d}`;
// A struck note for aevalsrc: silent before `on`, then a 1.7 ms attack and an exponential decay. `partials`
// is a sum over F, the note's phase (e.g. 'sin(F)+0.2*sin(2*F)').
export const strike = (on: number, freq: number, decay: number, partials: string): string =>
  `gte(t,${on})*exp(-${decay}*(t-${on}))*min(1,(t-${on})*600)*(${partials.replaceAll('F', `2*PI*${freq}*(t-${on})`)})`;
