// The prose of the goo row (fx-liquid.schemas.ts): a row of FX_DOCS (fx-docs.ts).
import type { FxDoc } from './fx-primitives.schemas';
import type { goo } from './fx-liquid.schemas';

export const gooDoc = {
  params: {
    blobs:
      'The blobs, placed and keyframed by hand (up to 8): {x, y, r, animate: {x, y, r}} in target fractions, ' +
      'times in section seconds; overrides the choreography (droplets, spread, angle, size, pop). Blobs closer ' +
      'than about 2.7 radii fuse with a neck; key r to 0 to absorb one.',
    droplets: 'Choreography: droplets that split off the main blob (default 2–3 from the seed).',
    spread:
      "Choreography: how far the farthest droplet travels, as a share of the target's width (default 0.3), " +
      'kept inside the target.',
    angle: 'Choreography: direction of the split in degrees, 0 = right, 90 = down (default ±15° around left or right).',
    size: "Choreography: the main blob's radius as a share of the target's short side (default 0.14).",
    goo:
      'Stickiness 0..1 (default 0.5): how far apart blobs still fuse and how thick their necks are (0 = ' +
      'nearly separate discs, 1 = long, syrupy necks).',
    pop: 'Choreography: grow from nothing at the start and shrink away at the end (default true).',
  },
  intent: {
    summary:
      'Liquid blobs that stretch, split into droplets and merge back, with smooth gooey necks between them: a ' +
      'solid shape in one colour, inside its target.',
    useWhen: 'a playful brand moment, a loading or "thinking" beat, a transition object that breaks apart and regroups',
    avoidWhen: 'behind body copy (it moves under the text); next to another fx in the same beat; corporate tone',
    vary: 'colour (default the theme accent); size, droplets, spread and angle shape the split; goo sets how syrupy it is; duration and ease its pace (2–3 s reads as liquid, faster as a splash); blobs for a choreography of your own.',
    reduced: 'one still blob that fades in and out',
  },
} satisfies FxDoc<(typeof goo)['params']>;
