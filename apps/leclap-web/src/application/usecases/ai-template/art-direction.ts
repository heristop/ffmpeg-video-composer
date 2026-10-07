// Prompt copy: the output contract, the builder's constraints and house art direction (genre doctrine
// and blueprints come from the engine's motion catalog). Kept apart from the prompt assembly so the
// words can be tuned without touching logic. Layout and type vary by brief: nothing here pins a
// single composition or a single font stack.

export const OUTPUT_CONTRACT = [
  'You write LeClap video templates. LeClap compiles a JSON template descriptor into a video with FFmpeg.',
  'Reply with exactly ONE JSON object: the complete template descriptor. No prose before or after it, no markdown fences, no comments.',
  'The object must validate against the JSON Schema at the end of this prompt.',
].join('\n');

export const BUILDER_CONSTRAINTS = [
  'Constraints (the template must open in the visual builder):',
  '- Never use sections of type "effect" or "partial".',
  '- Use "project_video" sections for the footage the user records or uploads; give each a title and description that tell them what to film.',
  '- Use "color_background" sections for title cards, chapter cards and the closing card. Put text on them with "kinetic" blocks (preferred: see the motion catalog) or "drawtext" filters; add "camera" and "graphics" where they serve the beat.',
  '- Do not reference image or video URLs; the only external files allowed are the fonts and music listed in the catalog (and, as a last resort, its sample animation overlays).',
  '- All durations are in seconds. Give every color_background section an explicit options.duration.',
  '- Set meta.name (short), meta.description (one sentence) and meta.creativeDirection (the brief you followed).',
  '- Set global.orientation. Coordinates are in pixels of the output frame: landscape 1280x720, portrait 720x1280, square 1080x1080.',
  '- Every {{ variable }} you use must be declared in global.variables or be a form field name.',
].join('\n');

// Display + text pairings from the bundled font set, per genre. With a theme, its $font tokens win.
export const GENRE_FONTS: Record<string, string> = {
  'product-launch': 'ArchivoBlack.ttf or Anton.ttf for the display line, Rubik.ttf for support',
  explainer: 'Rubik.ttf for headlines, RobotoMono.ttf for labels, numbers and steps',
  'social-hook': 'Bungee.ttf or Anton.ttf for the punch word, Rubik.ttf for the rest',
  'cinematic-trailer': 'PlayfairDisplay.ttf or AbrilFatface.ttf for titles, Oswald.ttf (spaced) for credits',
  'calm-tutorial': 'Rubik.ttf throughout (weight and size carry hierarchy), RobotoMono.ttf for UI labels',
};

const DEFAULT_FONTS =
  'pick by tone: editorial/luxury → PlayfairDisplay or AbrilFatface; tech/data → RobotoMono with Rubik; ' +
  'loud/sport → Anton, Bungee or BebasNeue; friendly → Righteous or Rubik; handwritten warmth → Pacifico or Lobster (one word only)';

function fontLine(genre: string | undefined, theme: string | undefined): string {
  if (theme) {
    return `- Type: global.theme is "${theme}": use "$font.display" for headlines and "$font.body" for everything else (font and fontfile fields); no third typeface.`;
  }

  const pairing = genre && Object.hasOwn(GENRE_FONTS, genre) ? GENRE_FONTS[genre] : DEFAULT_FONTS;

  return `- Type: at most two families from the bundled fonts — ${pairing}. Do not default to the same condensed face for every brief.`;
}

function colourLine(theme: string | undefined): string {
  if (theme) {
    return `- Colour: draw every colour from the theme ("$color.bg", "$color.fg", "$color.muted", "$color.surface", "$color.brand", "$color.accent", optional "@alpha"); literal hex colours outside it are flagged as palette drift.`;
  }

  return '- Colour: one background tone, one text colour, one accent, high contrast (WCAG AA). Tint neutrals toward the palette.';
}

export interface ArtDirectionHints {
  genre?: string;
  theme?: string;
}

// Layout vocabulary in pixels-of-frame expressions the drawtext / kinetic x,y fields accept.
const LAYOUT_LINES = [
  '- Composition varies per beat. Choose from: edge-anchored (x "w*0.08", baseline near y "h*0.72"); left-aligned stacks (headline and support share one left edge); asymmetric splits (type in one third, a panel or footage in the rest); layered (an oversized word at low alpha behind the headline, a panel as a backing plate); right-anchored labels (x "w-text_w-w*0.08").',
  '- Use at least two different compositions across the video. Reserve a centred layout for at most one beat (typically the final lockup) — never centre everything.',
  '- Keep text inside a safe area (8% from every edge; on portrait keep the bottom 18% clear for platform UI).',
];

export function artDirection(hints: ArtDirectionHints = {}): string {
  return [
    'Art direction:',
    '- One idea per scene. Short, concrete copy: headlines of 2–5 words, never paragraphs.',
    '- Strong hierarchy: one large display line, at most one supporting line, clear size contrast (≥ 2×).',
    ...LAYOUT_LINES,
    fontLine(hints.genre, hints.theme),
    colourLine(hints.theme),
    '- Motion with purpose: stagger reveals by 0.05–0.15 s, let text settle and hold at least 1 s to be read, exit before the cut.',
    '- Prefer the structured layers (kinetic, camera, graphics, look, grade, motion, transition, caption) over raw FFmpeg filters.',
    "- Follow the motion catalog rules below; they are the engine's own art direction.",
  ].join('\n');
}

export const STORY_SPINE = [
  'Story spine:',
  '- Beat 1 is a hook in outcome language: what the viewer gets or feels ("Notes that write themselves"), not what the product is.',
  '- State the value claim by beat 2 at the latest.',
  '- Every on-screen element has a verb from the motion catalog (RISES, CASCADES, SLAMS, LEANS IN, DRAWS, BRACKETS…); two elements with the same verb in one beat compete.',
  '- Vary tempo: the slowest beat lasts at least 3× the fastest.',
  '- One accent per section: a single element carries the accent colour or the strongest move.',
  '- For launches and reveals, hold the product back and reveal it sequentially through the back half (feature, feature, then the name/lockup).',
].join('\n');

// The motion workflow: compose from the engine, tuned to this brief, instead of picking stock looks.
export const COMPOSE_MOTION = [
  "Compose motion, don't pick it (stock looks make every video the same):",
  '1. Creative direction first: who is watching, what the brand feels like, how much energy (global.motion.energy).',
  '2. Write a motion intent per section, one line: what moves, why, and how it should feel (snaps, glides, settles, holds).',
  '3. Build each intent from engine primitives: kinetic typography, animate tracks with ease tokens or springs ($snappy, $expo, spring(k,c)), the camera (push-in, drift, orbit, hits), designed transitions, graphics and type "fx" primitives (light on a target), motion roles, beats and cues for timing.',
  '4. Tune the parameters for this brief (fx profile, width, tilt, direction, colour token, intensity, duration and ease; preset delay, stagger, distance and accent; camera amount). Never ship an effect with all-default parameters.',
  '5. One or two signature moves for the whole video, not one per section; the other beats stay simpler so the signature lands.',
  '- The library animation overlays (/assets/animations/*.apng: shine sweep, confetti, light leak…) are samples, not building blocks: use one only as a last resort, when no engine primitive can express the intent.',
].join('\n');

export const LAZY_DEFAULTS = [
  'Lazy defaults to avoid (each one reads as a generic template):',
  '- Everything centred.',
  '- The same ease on every element (vary by role: snappy for hits, smooth for holds, a spring for one hero).',
  '- Pure #000000 / #ffffff (use a tinted near-black and an off-white, or the theme tokens).',
  '- Purple-to-blue neon gradients.',
  '- Identical card layouts scene after scene.',
  '- Every element entering at t=0 (start 0.1–0.3 s after the cut, then stagger).',
  '- One transition type everywhere (one primary plus 1–2 accents, cut between beats of one idea).',
  '- Generic copy such as "Welcome to…", "Introducing…", "Let\'s get started".',
  '- Stock motion: a library animation overlay, the same effect or preset on every section, or effects left at their default parameters.',
].join('\n');

// Energy 0–4 in words, for the brief.
export const ENERGY_WORDS = ['calm', 'relaxed', 'balanced', 'punchy', 'explosive'];
