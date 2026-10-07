// The prose of the bokeh and dust rows (fx-particles.schemas.ts): a row of FX_DOCS each (fx-docs.ts).
import type { FxDoc } from './fx-primitives.schemas';
import type { bokeh, dust } from './fx-particles.schemas';

// The fields both rows share.
const DRIFT =
  'Drift heading in degrees, screen convention: 0 = right, 90 = down, -90 (or 270) = up. Default from the seed (bokeh: rising within ±70° of up; dust: settling or rising within ±35° of vertical).';

const CLEAR =
  "Half-size of the empty zone kept at the target's centre, as a share of the target (default 0.3 for bokeh, 0.2 for dust): where titles sit. 0 = particles anywhere.";

export const bokehDoc = {
  params: {
    count: 'Number of out-of-focus discs (default 6–10 from the seed). Fewer, larger discs read calmer.',
    size: "Radius of the nearest discs as a share of the target's short side (default ~0.1–0.15). The middle and far depth tiers are 0.6× and 0.35× that.",
    softness:
      'Edge roll-off as a share of the radius (default 0.25–0.45): 0 = crisp lens discs, 1 = soft glowing blobs.',
    drift: DRIFT,
    speed:
      'Drift of the nearest tier in target short sides per second (default 0.035, scaled by motion energy); far tiers move slower (parallax).',
    depth:
      'Parallax spread between depth tiers (default 0.5): 0 = all tiers drift together, 1 = far tiers almost still.',
    clear: CLEAR,
  },
  intent: {
    summary:
      'Out-of-focus light discs drifting slowly in three depth tiers (near discs larger, brighter and faster), clipped to the target: depth and warmth behind a title card or an intro.',
    useWhen: 'a calm title or name card needs depth; an intro or outro card over a flat or dark background',
    avoidWhen: 'busy footage, product shots, data or UI screens; more than one ambient texture per section',
    vary: 'count, size and softness set the lens (a few large soft discs vs. many crisp ones); drift and speed set the air; depth sets the parallax; colour (e.g. "$color.accent") tints the light; seed re-rolls the layout. Set duration to the section length.',
    reduced: 'absent (ambient motion is dropped)',
  },
} satisfies FxDoc<(typeof bokeh)['params']>;

export const dustDoc = {
  params: {
    count: 'Motes visible at once on average (default 16–24 from the seed).',
    size: 'Mote diameter in px at 720p, scaled to the frame (default 2.5: about 2 and 3 px motes; smaller ones vanish under video compression at the 0.12 ceiling).',
    drift: DRIFT,
    speed: 'Drift in target short sides per second (default 0.012, scaled by motion energy, ±50% per mote).',
    flicker:
      'How often motes catch and lose the light (default 0.5): 0 = every mote stays for the whole effect, 1 = short lives (about a third of the effect) fading in and out.',
    clear: CLEAR,
  },
  intent: {
    summary:
      'Fine motes of dust drifting and catching the light (1–2 px, seeded positions and lives), clipped to the target: air in a still photo or a quiet interview intro.',
    useWhen: 'a still photo, a backdrop or a slow interview intro needs air and texture',
    avoidWhen: 'fast cuts, bright flat UI screens; together with bokeh or grain in the same section',
    vary: 'count and size set the density; drift and speed set the air (settling vs. rising warm air); flicker sets how often motes catch the light; colour tints them; seed re-rolls the field. Set duration to the section length.',
    reduced: 'absent (ambient motion is dropped)',
  },
} satisfies FxDoc<(typeof dust)['params']>;
