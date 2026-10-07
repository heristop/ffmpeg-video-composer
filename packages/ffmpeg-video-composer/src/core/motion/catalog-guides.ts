// Art direction per motion primitive: the verb an element performs on screen, when to reach for it,
// when not to, and what it pairs with. Every element in a beat should have a verb; two elements
// with the same verb in one beat compete.

export interface MotionGuide {
  /** What the element does on screen, as a storyboard verb. */
  verb: string;
  useWhen: string;
  avoidWhen: string;
  pairsWith: string[];
}

function guide(verb: string, useWhen: string, avoidWhen: string, pairsWith: string[]): MotionGuide {
  return { verb, useWhen, avoidWhen, pairsWith };
}

export const KINETIC_GUIDES: Record<string, MotionGuide> = {
  cascade: guide('CASCADES', 'a headline that should read word by word', 'calm instructions or long sentences', [
    'camera push-in',
    'underline',
  ]),
  rise: guide('RISES', 'a controlled, premium headline or supporting line', 'a punchline that needs weight', [
    'panel',
    'drift camera',
  ]),
  drop: guide('DROPS', 'playful arrivals with a bounce on landing', 'serious or premium tone', ['camera hits', 'pop']),
  slide: guide('SLIDES', 'lists and sequences that read in one direction', 'a centred hero word', [
    'push-left transition',
    'panel',
  ]),
  pop: guide('POPS', 'labels, badges, short playful words', 'product-launch headlines (overshoot reads cheap)', [
    'corners',
    'drop',
  ]),
  impact: guide('SLAMS', 'one punch word on a beat', 'more than one block per beat, or calm content', [
    'camera hits',
    'flash',
  ]),
  'tracking-in': guide('TIGHTENS', 'a brand or product name, keynote title', 'body copy or fast cuts', [
    'push-in',
    'bars',
  ]),
  typewriter: guide('TYPES', 'a question, a prompt, code or a tech reveal', 'anything over ~40 characters', [
    'scramble',
    'frame',
  ]),
  scramble: guide('DECODES', 'a reveal moment, a secret, a data feel', 'emotional or calm content', [
    'typewriter',
    'corners',
  ]),
  wave: guide('WAVES', 'a light, musical, playful line that holds', 'serious content or a busy frame', [
    'pop',
    'drift-up',
  ]),
  highlight: guide('MARKS', 'pointing at the one word that matters', 'more than one accent per line', [
    'cascade',
    'underline',
  ]),
  counter: guide('COUNTS', 'a stat, a price, a growth number', 'numbers the viewer must not misread mid-roll', [
    'corners',
    'fade label',
  ]),
  split: guide('LOCKS', 'a closing statement or a two-part idea', 'long lines (halves travel far)', [
    'pull-out',
    'iris',
  ]),
  fade: guide('FADES', 'calm instructions, attributions, small print', 'the hero element of a beat', [
    'drift camera',
    'any hero preset',
  ]),
};

export const CAMERA_GUIDES: Record<string, MotionGuide> = {
  none: guide('HOLDS', 'the copy carries the motion, or a still must read as still', 'long beats on a flat colour', [
    'impact',
    'hits',
  ]),
  'push-in': guide('LEANS IN', 'build-up toward a reveal or a key line', 'every beat (it stops meaning anything)', [
    'cascade',
    'tracking-in',
  ]),
  'pull-out': guide('PULLS BACK', 'endings, context reveals, a sign-off', 'the opening hook', ['split', 'outro']),
  'drift-left': guide('DRIFTS', 'calm beats and readable holds', 'beats with impact type', ['rise', 'fade']),
  'drift-right': guide('DRIFTS', 'calm beats and readable holds', 'beats with impact type', ['rise', 'fade']),
  'drift-up': guide('FLOATS', 'uplifting or aspirational lines', 'sombre content', ['wave', 'rise']),
  'drift-down': guide('SETTLES', 'grounding, conclusions', 'the opening hook', ['fade', 'split']),
  orbit: guide('CIRCLES', 'a product shot or hero still', 'text-only beats (feels like drift)', ['panel', 'corners']),
  handheld: guide('SWAYS', 'documentary, trailer, raw authenticity', 'product launches and tutorials', [
    'bars',
    'tracking-in',
  ]),
};

export const TRANSITION_GUIDES: Record<string, MotionGuide> = {
  cut: guide('CUTS', 'beats of the same idea, on the music beat, fast pacing', 'a change of chapter that needs air', [
    'impact',
    'camera hits',
  ]),
  fade: guide('DISSOLVES', 'calm, time passing, soft chapters', 'energetic edits', ['drift camera', 'fade type']),
  fadeblack: guide('DIPS', 'chapter breaks, trailer beats', 'consecutive boundaries', ['bars', 'tracking-in']),
  dissolve: guide('DISSOLVES', 'textured, organic changes', 'crisp product content', ['drift camera']),
  'push-left': guide('PUSHES', 'a sequence moving forward (steps, features)', 'unrelated scenes', ['slide', 'panel']),
  'push-right': guide('PUSHES BACK', 'going back, before/after', 'forward sequences', ['slide']),
  'push-up': guide('PUSHES UP', 'stacking content, lists, scroll feel', 'cinematic tone', ['rise']),
  'push-down': guide('PUSHES DOWN', 'revealing what sits above, a drop', 'the opening hook', ['drop']),
  'swipe-left': guide('SWIPES', 'layering a new idea over the last', 'calm tutorials', ['slide', 'wipe']),
  'swipe-right': guide('SWIPES BACK', 'layering in the opposite direction', 'calm tutorials', ['slide']),
  'zoom-through': guide('FLIES THROUGH', 'one energy peak, hook into product', 'more than once per video', [
    'push-in',
    'impact',
  ]),
  iris: guide('OPENS', 'a reveal or the final lockup', 'mid-sequence boundaries', ['split', 'pull-out']),
  'whip-left': guide(
    'WHIPS',
    'a fast jump to the next idea, hype edits, on a beat',
    'calm or premium tone, or every boundary',
    ['impact', 'camera hits']
  ),
  'whip-right': guide('WHIPS BACK', 'a fast jump back, before/after reveals', 'calm or premium tone', [
    'impact',
    'glitch',
  ]),
  'whip-up': guide('WHIPS UP', 'energetic list or feed-style stacking', 'cinematic tone', ['rise', 'pop']),
  'whip-down': guide('WHIPS DOWN', 'a drop into the next beat', 'the opening hook', ['drop', 'flash']),
};

export const GRAPHIC_GUIDES: Record<string, MotionGuide> = {
  flash: guide('FLASHES', 'an impact beat, at most 3 per second', 'calm content or photosensitive audiences', [
    'impact',
    'camera hits',
  ]),
  bars: guide('LETTERBOXES', 'a cinematic chapter or trailer title', 'portrait social video', [
    'tracking-in',
    'handheld',
  ]),
  underline: guide('DRAWS', 'emphasis under a headline after it lands', 'more than one per beat', [
    'cascade',
    'highlight',
  ]),
  frame: guide('TRACES', 'framing a stat or a quote', 'busy frames', ['counter', 'typewriter']),
  corners: guide('BRACKETS', 'focus on a product, a stat or a face', 'full-bleed type', ['counter', 'orbit']),
  wipe: guide('WIPES', 'an in-scene page turn between two ideas', 'a beat that already ends on a transition', [
    'slide',
    'swipe',
  ]),
  panel: guide('GROWS', 'a backing plate for type over images', 'centred hero words', ['rise', 'slide']),
  glitch: guide(
    'GLITCHES',
    'a hook, a tech or data reveal, a hard cut on the beat',
    'calm, premium or photosensitive content; more than once per beat',
    ['impact', 'whip transition']
  ),
  focus: guide(
    'RACKS FOCUS',
    'opening a cinematic beat, pulling attention from the scene to the copy',
    'fast cuts (the blur needs time to read)',
    ['tracking-in', 'bars']
  ),
  progress: guide('FILLS', 'steps, countdowns, a story or tutorial progress', 'short hooks', [
    'counter',
    'lower third',
  ]),
  ticker: guide(
    'SCROLLS',
    'news, live or announcement feel, a secondary stream of info',
    'beats with dense kinetic copy',
    ['lower third', 'corners']
  ),
  'bars-chart': guide(
    'GROWS DATA',
    'comparing a few numbers, growth over time',
    'more than 6 bars on a phone, or numbers that need reading time under 2 s',
    ['counter', 'frame']
  ),
  fx: guide(
    'LIGHTS',
    'a hero element lands (card, screen, product, title): compose the primitive for this template',
    'stacking light effects on one beat, or the same untuned parameters on every template',
    ['panel', 'rise', 'push-in']
  ),
};

export const LOWER_THIRD_GUIDES: Record<string, MotionGuide> = {
  band: guide('NAMES', 'the default: a full-width band, names and prices over any footage', 'clean, minimal looks', [
    'fade',
    'drift camera',
  ]),
  'clean-bar': guide(
    'LABELS',
    'interviews and talking heads: tight boxes that do not cover the frame',
    'very long titles',
    ['rise', 'push-in']
  ),
  'side-rule': guide(
    'ANNOTATES',
    'editorial or documentary names over busy footage (pair with a shadow effect)',
    'flat bright backgrounds',
    ['focus', 'drift camera']
  ),
  kicker: guide('INTRODUCES', 'a topic or role label above a name, explainers', 'a subtitle longer than a few words', [
    'underline',
    'cascade',
  ]),
  'stack-bars': guide('STACKS', 'energetic social or sports-style names and handles', 'calm tutorials', [
    'slide',
    'whip transition',
  ]),
  pill: guide('BADGES', 'friendly app, product or creator labels', 'serious news tone', ['pop', 'corners']),
};
