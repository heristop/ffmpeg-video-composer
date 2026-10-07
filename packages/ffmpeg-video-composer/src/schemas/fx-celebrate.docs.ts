// The prose of the ripple, glint and confetti rows (fx-celebrate.schemas.ts): a row of FX_DOCS each (fx-docs.ts).
import type { FxDoc } from './fx-primitives.schemas';
import type { ripple, glint, confetti } from './fx-celebrate.schemas';

export const rippleDoc = {
  params: {
    variant:
      'ring (default): anti-aliased rings expanding from the origin and fading out (a pulse, a radar, a "look here"). tap: a filled dot pressed in and released, then one ring (a UI tap on a button).',
    origin: 'Ring centre, as fractions of the target ({x, y}; default the target centre).',
    radius:
      "The rings' final radius as a share of the target's short side (default 0.9–1.2 from the seed, so the ring clears its target; a tap on a small button: 0.9–1.4 so the ring clears it).",
    rings: 'Rings per pass (default 2 for ring, 1 for tap).',
    stagger: 'Seconds between ring starts (default 0.18). The pass duration covers every ring.',
    start: 'Ring size when it appears, as a share of its final size (default 0.375: 0.6 → 1.6).',
    stroke: 'Ring stroke in px at 1080p, at full size (default 5; scaled to the output frame).',
    halo: 'Gaussian halo around the stroke, σ in px at 1080p (default 6; 0 = a bare line).',
    dot: "tap: the pressed dot's radius as a share of the final ring radius (default 0.28).",
    press: 'tap: how far the dot sinks on press, as a share of its size (default 0.09: 0.9 → 0.82 → 1).',
  },
  intent: {
    summary:
      'Expanding anti-aliased rings (or a pressed dot plus a ring) from a point of the target: a tap, a pulse, a "look here".',
    useWhen: 'a UI tap in a product demo; a call to action or a hotspot that needs one beat of attention',
    avoidWhen: 'on every element of a section; over faces; more than two passes in a row (it reads as an alarm)',
    vary: 'variant sets the gesture (ring = pulse, tap = touch); origin puts it on the exact control; radius, start and stroke set its scale and weight; rings + stagger set its rhythm; colour defaults to the theme accent.',
    reduced: 'one still ring at its middle size that fades in and out (an opacity pulse, no growth)',
  },
} satisfies FxDoc<(typeof ripple)['params']>;

export const glintDoc = {
  params: {
    path: "Where the light sits: scatter (default: seeded points on the target, biased to its upper half and corners, like specular highlights), corners (just inside its corners), orbit (lights travelling around the target's edge with a short trail: a spec orbit for product shots).",
    points: 'Exact star positions as target fractions; overrides path and count (scatter/corners only).',
    count: 'Stars (default 3–5 from the seed, fewer on small targets) or orbiting lights (default 2).',
    size: 'Star span in px at 1080p (default 36–52 per star from the seed, 34 for orbit lights; scaled to the output frame).',
    stagger: 'Seconds between star twinkles (default 0.12). The pass duration covers every star.',
    spin: 'Degrees each star turns while it twinkles (default 15; 0 = no turn).',
    trail: 'orbit: strength of the trail behind each light (default 0.4; 0 = none).',
    speed: 'orbit: revolutions per second (default 0.9).',
  },
  intent: {
    summary:
      'Four-point star glints that twinkle once on a target (scale up, turn, vanish), or small lights orbiting it: the sparkle of something new or polished.',
    useWhen: 'a product, a logo or a price lands; a "new" badge; jewellery, glass, chrome',
    avoidWhen: 'over text you need read; on footage with busy highlights; together with confetti in one beat',
    vary: 'path sets the character (scatter = sparkle, corners = a framed gem, orbit = a spec orbit); count, size and points set the density; stagger and duration set the rhythm; spin and the twinkle ease set the snap; colour tints the light.',
    reduced: 'the stars appear at rest at half size and fade in and out (no scale, turn or travel)',
  },
} satisfies FxDoc<(typeof glint)['params']>;

export const confettiDoc = {
  params: {
    count: 'Pieces in the burst (default 28–36, from the seed). Repeated passes share 36.',
    origin: 'Where the burst starts, as fractions of the target ({x, y}; default the target centre, {x: 0.5, y: 0.5}).',
    angle: 'Burst direction in degrees: -90 = up (default), 0 = right, 90 = down, ±180 = left.',
    spread: 'Cone the pieces leave in, degrees around angle (default 90–130 from the seed; 360 = all around).',
    speed: 'Launch speed in frame heights per second (default 1.5; each piece varies ±25 %).',
    gravity: 'Downward pull in frame heights per s² (default 1.6; 0 = floating).',
    drag: 'Air drag per second (default 3.2): higher = pieces stall and drift down slowly, like paper.',
    sway: 'Side-to-side flutter while falling, in frame widths (default 0.012).',
    spin: 'Maximum tumble in turns per second (default 1.4; each piece gets its own rate and sense).',
    size: "A piece's long side in px at 1080p (default 28; scaled to the output frame).",
    discs: 'Share of round pieces; the rest are 2:1 strips (default 0.2).',
    colors:
      'Palette, 1–5 colours ("#rrggbb", names or "$color.*" tokens). Default: the theme accent, accent2, brand and a neutral (fg).',
    depth: 'Depth tiers: 1 (default) gives pieces at 0.6 / 0.8 / 1.0 size with slight alpha; 0 = all equal.',
    fade: 'Seconds faded out at the end of the burst (default 0.5).',
  },
  intent: {
    summary:
      'A ballistic burst of tumbling paper pieces in the theme colours: launched from a point, slowed by drag, pulled down by gravity, swaying as they fall.',
    useWhen: 'a real celebration: a launch, a milestone, a win, a sign-up count; once per video',
    avoidWhen: 'serious, corporate or editorial tones; behind text that must be read; more than one burst per video',
    vary: 'origin, angle and spread aim it (a cannon from a corner, a fountain from below, a pop from the centre); speed, gravity and drag set the physics (snappy vs. floaty); count, size and discs set the density; colors restyle it (theme tokens by default).',
    reduced: 'a few pieces appear at rest around the origin and fade in and out (no flight, no tumble)',
  },
} satisfies FxDoc<(typeof confetti)['params']>;
