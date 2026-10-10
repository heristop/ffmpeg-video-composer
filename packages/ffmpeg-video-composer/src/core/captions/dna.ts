// Caption DNA: a caption identity as data. One id picks the font, scale, colours, legibility treatment,
// letter case, karaoke behaviour, entrance and the "crown" (the one emphasised payoff line), so a
// subtitle track reads as designed rather than defaulted. Colours may be theme tokens (`$color.accent`),
// resolved against `global.theme` at lowering time. Pure data, no imports: the schema, the lowering and
// the motion catalog all read this table.

export type CaptionKaraoke = false | 'word' | 'fill' | 'pop';
export type CaptionCase = 'none' | 'upper';
export type CaptionPosition = 'top' | 'center' | 'bottom' | 'lower-third';
export type CaptionEntrance = 'none' | 'fade' | 'rise';

export interface CaptionDnaEffect {
  shadow?: { color: string; dx: number; dy: number };
  outline?: { color: string; width: number };
}

export interface CaptionDna {
  description: string;
  /** Bundled font id (laid out with its advance table). */
  font: string;
  /** Font size as a fraction of the frame's short side. */
  size: number;
  /** Line spacing as a multiple of the size. */
  lineHeight: number;
  /** Words not yet (or no longer) active. */
  color: string;
  /** The active word (karaoke) and the default crown colour. */
  activeColor: string;
  case: CaptionCase;
  karaoke: CaptionKaraoke;
  /** Size multiplier of the active word in `word` karaoke, and the peak of the `pop` bump. */
  activeScale: number;
  position: CaptionPosition;
  effect?: CaptionDnaEffect;
  /** A plate behind each line, with corners rounded row by row (padding and radius as fractions of size). */
  box?: { color: string; padding: number; radius: number };
  entrance: { type: CaptionEntrance; duration: number; distance: number; easing: string };
  /** The payoff line: drawn larger, in its own colour (and case). */
  crown: { scale: number; color: string; case?: CaptionCase };
}

const SOFT_SHADOW = { shadow: { color: '#000000@0.55', dx: 2, dy: 3 } };

export const CAPTION_DNA = {
  clean: {
    description:
      'White Rubik with a soft shadow; the spoken word turns warm yellow. The safe default for talking heads.',
    font: 'rubik',
    size: 0.062,
    lineHeight: 1.22,
    color: '#FFFFFF',
    activeColor: '$color.accent2',
    case: 'none',
    karaoke: 'word',
    activeScale: 1,
    position: 'lower-third',
    effect: SOFT_SHADOW,
    entrance: { type: 'fade', duration: 0.14, distance: 0, easing: 'ease-out' },
    crown: { scale: 1.2, color: '$color.accent2' },
  },
  loud: {
    description:
      'Heavy Anton capitals with a thick outline; each word pops in the accent colour. Hype, sports, reactions.',
    font: 'anton',
    size: 0.088,
    lineHeight: 1.12,
    color: '#FFFFFF',
    activeColor: '$color.accent',
    case: 'upper',
    karaoke: 'pop',
    activeScale: 1.22,
    position: 'center',
    effect: { outline: { color: '#000000', width: 5 } },
    entrance: { type: 'rise', duration: 0.18, distance: 14, easing: 'spring(420, 30)' },
    crown: { scale: 1.3, color: '$color.accent2', case: 'upper' },
  },
  keynote: {
    description: 'Calm Rubik: upcoming words wait dimmed, spoken words fill in and stay. Talks, explainers, narration.',
    font: 'rubik',
    size: 0.056,
    lineHeight: 1.25,
    color: '#FFFFFF@0.42',
    activeColor: '#FFFFFF',
    case: 'none',
    karaoke: 'fill',
    activeScale: 1,
    position: 'lower-third',
    effect: { shadow: { color: '#000000@0.4', dx: 0, dy: 2 } },
    entrance: { type: 'fade', duration: 0.22, distance: 0, easing: 'ease-out' },
    crown: { scale: 1.15, color: '$color.brand' },
  },
  documentary: {
    description: 'Small Oswald set low with a soft shadow and no karaoke: unobtrusive, broadcast-style subtitles.',
    font: 'oswald',
    size: 0.046,
    lineHeight: 1.2,
    color: '#F5F3F7',
    activeColor: '#FFFFFF',
    case: 'none',
    karaoke: false,
    activeScale: 1,
    position: 'bottom',
    effect: SOFT_SHADOW,
    entrance: { type: 'fade', duration: 0.12, distance: 0, easing: 'linear' },
    crown: { scale: 1.1, color: '#FFFFFF' },
  },
  boxed: {
    description: 'Rubik on a rounded ink plate per line; the spoken word turns yellow. Legible over any footage.',
    font: 'rubik',
    size: 0.056,
    lineHeight: 1.5,
    color: '#FFFFFF',
    activeColor: '$color.accent2',
    case: 'none',
    karaoke: 'word',
    activeScale: 1,
    position: 'lower-third',
    box: { color: '$color.bg@0.82', padding: 0.3, radius: 0.32 },
    entrance: { type: 'fade', duration: 0.12, distance: 0, easing: 'ease-out' },
    crown: { scale: 1.15, color: '$color.accent2' },
  },
  neon: {
    description:
      'Righteous with a brand-coloured glow outline; the spoken word lights up slightly larger. Night, music, gaming.',
    font: 'righteous',
    size: 0.066,
    lineHeight: 1.2,
    color: '#FFFFFF',
    activeColor: '$color.accent',
    case: 'none',
    karaoke: 'word',
    activeScale: 1.08,
    position: 'lower-third',
    effect: {
      outline: { color: '$color.brand@0.75', width: 4 },
      shadow: { color: '$color.brand@0.5', dx: 0, dy: 0 },
    },
    entrance: { type: 'rise', duration: 0.2, distance: 10, easing: 'ease-out' },
    crown: { scale: 1.25, color: '$color.accent2' },
  },
} as const satisfies Record<string, CaptionDna>;

export type CaptionDnaId = keyof typeof CAPTION_DNA;

export const CAPTION_DNA_IDS = Object.keys(CAPTION_DNA) as [CaptionDnaId, ...CaptionDnaId[]];

export const DEFAULT_CAPTION_DNA: CaptionDnaId = 'clean';

/** The DNA for an id, or the default for anything else. */
export function captionDna(id: string | undefined): CaptionDna {
  const key = id ?? DEFAULT_CAPTION_DNA;

  return Object.hasOwn(CAPTION_DNA, key) ? CAPTION_DNA[key as CaptionDnaId] : CAPTION_DNA[DEFAULT_CAPTION_DNA];
}

/** The catalog an agent reads: every caption identity with its look. */
export function captionDnaCatalog(): Array<{ id: CaptionDnaId } & CaptionDna> {
  return CAPTION_DNA_IDS.map((id) => ({ id, ...CAPTION_DNA[id] }));
}
