// The prose of the leak and edge-glow rows (fx-light.schemas.ts): a row of FX_DOCS each (fx-docs.ts).
import type { FxDoc } from './fx-primitives.schemas';
import type { LEAK, EDGE_GLOW } from './fx-light.schemas';

export const leakDoc = {
  params: {
    edge: 'Where the off-frame source sits (default from the seed: a side or a top corner, top corners on tall targets). The light pours in from there and never reaches the far side.',
    size: "Lobe radius as a fraction of the target's long side (default 0.3–0.42 from the seed). 0.25 = a tight flare at the edge, 1+ = a wash over half the frame.",
    stretch: 'Lobe elongation along its edge (default 1–1.3): 1 = round, 2+ = a long streak hugging the edge.',
    drift:
      "Travel along the edge over one pass, as a fraction of the edge's length; the sign sets the direction (default ±0.06–0.10 from the seed). 0 = a still leak.",
    secondary:
      'Colour of the second lobe: "#rrggbb" or a theme token (default rose #FF7A88; the first lobe is `color`, default amber #FFB36B, both nudged toward the theme accent).',
    balance: 'Strength of the second lobe relative to the first (default 0.55–0.8). 0 = a single lobe.',
    spread: 'Offset of the second lobe along the edge, in lobe radii (default 0.5–0.9).',
    shadows:
      'How much the shadows are kept clean (default 1: the light lifts the mid-tones and never the blacks; 0 = a wash into the shadows too). Surfaces brighter than the light itself are always left alone.',
    rise: 'Share of the life spent fading in (default 0.3); ease-in, so it blooms rather than switches on.',
    fall: 'Share of the life spent fading out (default 0.5): a leak leaves more slowly than it arrives.',
  },
  intent: {
    summary:
      'A warm light leak: two soft radial lobes from an off-frame source at one edge, drifting slowly along it, rising and fading like film exposure. It lifts the mid-tones, never the blacks, never greys a bright surface, and has no edge anywhere.',
    useWhen: 'a beat change or an entrance on footage or photos; a warm, analogue transition accent',
    avoidWhen: 'over text-heavy cards or UI screenshots; several leaks in a row (one per scene change at most)',
    vary: 'edge and drift set where the light comes from and where it goes; size and stretch set its reach; color/secondary/balance set the hue (amber+rose, gold, teal, the brand accent); rise/fall and duration set the exposure; intensity ≤ 1 keeps it under 0.25.',
    reduced: 'a still, dimmer leak that fades in and out without drifting',
  },
} satisfies FxDoc<(typeof LEAK)['params']>;

export const edgeGlowDoc = {
  params: {
    line: 'Opacity of the inner hairline (default 0.55; 0 = glow only).',
    lineWidth: 'Hairline width in px at 1080p, scaled with the frame (default 1.5).',
    spread: 'Bloom radius (gaussian σ) in px at 1080p, scaled with the frame (default 8–12 from the seed).',
    glow: 'Bloom colour: "#rrggbb" or a theme token (default: the light colour pushed toward the theme accent). The hairline stays near-white.',
    breathe: 'Opacity swing of the bloom, ± share (default 0.06; 0 = steady).',
    period: 'Seconds per breath (default 3.6–4.8 from the seed).',
  },
  intent: {
    summary:
      "A glow around a card or video rect: a crisp inner hairline plus a soft bloom outside the target's (rounded) shape only, breathing gently.",
    useWhen: 'a name card, a CTA or a product card that should read as lit or active; a focused pane',
    avoidWhen: 'on the full frame (use leak or bloom); on more than one card at once',
    vary: 'spread and intensity set how far it radiates; glow (e.g. "$color.accent") sets the tint; line and lineWidth set the hairline; breathe and period set the pulse (0 for a still glow).',
    reduced: 'the same glow, still (no breathing)',
  },
} satisfies FxDoc<(typeof EDGE_GLOW)['params']>;
