// The motion catalog: everything an agent needs to choose and configure motion without reading
// source. One data structure serves MCP (`get_motion_catalog`), the CLI and the template builder's
// prompt-to-template flow, so they always agree with the engine.

import { fullFootageCatalog, type FullFootageCatalog } from './catalog-footage';
import { CSS_BEZIERS, NAMED_CURVES } from './curves';
import { LEGACY_EASINGS, MIN_DAMPING_RATIO } from './easing';
import { BUILTIN_MOTION_TOKENS } from './tokens';
import { kineticCatalog } from '../kinetic/presets';
import { KINETIC_EXIT_PRESETS, KINETIC_ORDERS } from '../../schemas/kinetic.schemas';
import { CAMERA_PRESETS } from '../../schemas/camera.schemas';
import { DESIGNED_TRANSITION_DESCRIPTIONS } from './transitions';
import { platformCatalog, type PlatformCatalogEntry } from '../platforms';
import { themeCatalog, type ThemeCatalog } from '../theme/catalog';
import {
  CAMERA_GUIDES,
  GRAPHIC_GUIDES,
  KINETIC_GUIDES,
  LOWER_THIRD_GUIDES,
  TRANSITION_GUIDES,
  type MotionGuide,
} from './catalog-guides';
import { GENRE_DOCTRINE, type GenreDoctrine, type MotionGenre } from './catalog-doctrine';
import { MOTION_BLUEPRINTS, type MotionBlueprint } from './catalog-blueprints';
import { PARTIAL_GUIDE } from './catalog-partials';
import { motionRolesCatalog, type MotionRolesCatalog } from './catalog-roles';
import { FORMATS_ART_DIRECTION, FORMATS_GUIDE } from '../formats/guide';

export type { MotionGuide } from './catalog-guides';
export type { GenreDoctrine, MotionGenre } from './catalog-doctrine';
export type { BlueprintRole, MotionBlueprint } from './catalog-blueprints';
export { partialCatalog, type PartialSummary } from './catalog-partials';
import {
  COMPOSITING,
  COMPOSITING_RULES,
  htmlCatalog,
  type CompositingCatalog,
  type HtmlCatalog,
} from './catalog-compositing';
import { captionCatalog, type CaptionCatalog } from '../captions/catalog';
import { audioCatalog, type AudioCatalog } from '../audio/catalog';
import { TIMING } from './catalog-timing';
import { fxCatalog, samplesCatalog, type FxCatalog, type SamplesCatalog } from './fx-catalog';

const ART_DIRECTION = [
  'Compose, do not pick: derive the motion from the creative direction (audience, brand, energy), write one ' +
    'motion intent per section, choose engine primitives for it (kinetic, animate tracks with ease tokens or ' +
    'springs, camera, designed transitions, graphics, fx), then tune their parameters: never ship all defaults. ' +
    'One or two signature moves per video, not one per section. Library animations are samples: a last resort.',
  'One idea per beat: one dominant kinetic block, at most one supporting block. Hold every beat at least ' +
    '0.4 s + words / 3.5 s after the last unit lands.',
  'Pick a preset for the job: cascade/rise for headlines, impact for a single punch word, pop for playful ' +
    'labels, tracking-in for a brand title, typewriter/scramble for tech or reveal moments, highlight to ' +
    'point at one word, counter for a stat, split for a closing statement, fade for calm instructions.',
  'Physics over timing: prefer spring eases ($snappy, $bouncy, $gentle) and omit duration so the spring ' +
    'decides. Use $expo or $smooth when a move must feel controlled rather than physical.',
  'Use global.motion.energy as the single intensity dial (0 reduced motion, 1 default, 1.5 hype) instead ' +
    'of editing every distance.',
  'Accent one word per line at most (accent.words), in a brand colour. Vary presets between beats; the same ' +
    'preset three beats in a row reads as a template, not direction.',
  'Exits: none for a hard cut on the beat, fade for calm, cascade for energy. A block holds to the cut by default.',
  'Word/glyph units need a bundled font (bebas, oswald, anton, archivo-black, bungee, mono, rubik, playfair, ' +
    'righteous, abril-fatface, lobster, pacifico, noto-arabic, noto-hebrew). At most 64 units per block; longer copy steps up to words/lines.',
  ...COMPOSITING_RULES,
  'Camera: one move per beat (push-in for build-up, drift for calm, orbit for product, handheld for documentary); ' +
    'add hits on the beats where impact type lands, optionally with a flash graphic at the same time.',
  'Graphics: corners or frame for focus, underline under a headline, panel as a backing plate, bars for cinema, ' +
    'wipe as an in-scene page turn, flash for impact (at most 3 per second), glitch for a hook hit, focus to rack ' +
    'into a beat, progress / ticker / bars-chart for data and broadcast.',
  'Transitions: push for sequence, swipe for layering, zoom-through for energy, iris for reveals, whip for a fast ' +
    'jump on the beat (0.3–0.5 s); keep the others 0.5–0.8 s and prefer cut between beats of the same idea. ' +
    'Designed transitions ease like any other motion (ease: $snappy…).',
  'Kinetic trail ({ echoes, delta, fade }) smears fast travel (impact, drop, slide, whip-paced edits); skip it on ' +
    'calm presets and on long copy, where the echoes multiply the draw cost.',
  'Set global.platform (tiktok, reels, shorts, youtube, x, linkedin, facebook, square-feed) when the video ' +
    'has a destination: keep kinetic copy and graphics out of its safe zones (see platforms[].safe, fractions ' +
    'of the frame per edge) and the timeline under platforms[].maxDuration.',
  FORMATS_ART_DIRECTION,
  'Every result is deterministic: the same JSON and global.seed render the same frames. Change the seed to ' +
    'reshuffle random order, scramble glyphs and grain.',
  'Pick a genre doctrine first, then a blueprint per narrative role; keep each blueprint signatureMove. Every ' +
    'element needs a verb (see each entry); two elements with the same verb in one beat compete.',
  'Pacing: one primary transition plus 1–2 accents; the transition is the exit (no element exit right before it); ' +
    'start text 0.1–0.3 s after the cut; vary eases by role; the slowest beat runs ≥ 3× the fastest.',
  'Prove the choreography with section `assert` (visibleBy, before, inFrame, keepsMoving) and read the advisory ' +
    'motionWarnings from validate_template before rendering.',
];

const STARTER = {
  meta: { name: 'Kinetic starter' },
  global: { orientation: 'landscape', fps: 30, musicEnabled: false, seed: 1, motion: { energy: 1 } },
  sections: [
    {
      name: 'hook',
      type: 'color_background',
      options: { backgroundColor: '#141416', duration: 3 },
      camera: { preset: 'push-in', amount: 0.08, hits: [0.6] },
      graphics: [{ type: 'flash', at: 0.6, duration: 0.25 }],
      kinetic: [
        {
          id: 'headline',
          text: { en: 'Make every word land.' },
          preset: 'cascade',
          accent: { words: 'last' },
          exit: 'cascade',
        },
        {
          text: { en: 'Physics, not keyframes' },
          preset: 'highlight',
          font: 'oswald',
          size: 46,
          y: 'bottom',
          delay: 'headline.end + 0.1',
        },
      ],
    },
  ],
};

type Guided<T> = T & MotionGuide;

export interface MotionCatalog {
  rules: string[];
  doctrine: Record<MotionGenre, GenreDoctrine>;
  blueprints: MotionBlueprint[];
  kinetic: {
    presets: Array<Guided<ReturnType<typeof kineticCatalog>[number]>>;
    exits: readonly string[];
    orders: readonly string[];
    units: readonly string[];
    trail: Guided<{ description: string; fields: string[] }>;
  };
  /** `kinetic[].fill` shapes and `sections[].layout` types, with their fields. */
  compositing: CompositingCatalog;
  easing: {
    historical: readonly string[];
    named: string[];
    functions: string[];
    springRules: string;
  };
  camera: { presets: Array<Guided<{ preset: string }>>; fields: string[] };
  transitions: Record<string, Guided<{ description: string }>>;
  graphics: Record<string, Guided<{ description: string }>>;
  /** Procedural light primitives (graphics type fx): open parameters, targets and design intent. */
  fx: FxCatalog;
  /** The creative kit's library animations: demo samples, each mapped to the engine primitives that replace it. */
  samples: SamplesCatalog;
  /** `lowerThird.style` presets; `band` is the default look (no style). */
  lowerThirds: Record<string, Guided<{ description: string }>>;
  tokens: typeof BUILTIN_MOTION_TOKENS;
  /** Motion roles (micro, panel, camera, headline, accent, mascot): defaults, guidance and rules. */
  roles: MotionRolesCatalog;
  /** Delivery platforms for `global.platform`: orientation, safe zones, max duration, loudness. */
  platforms: PlatformCatalogEntry[];
  /** Built-in themes (palette, fonts, motion feel) and the `$color.*` / `$font.*` grammar. */
  themes: ThemeCatalog;
  /** Word-timed captions (`sections[].subtitles`): caption DNA identities, karaoke modes, grouping. */
  captions: CaptionCatalog;
  timing: typeof TIMING;
  /** Partials: rhetorical jobs, the elastic envelope, sync points and align. */
  partials: typeof PARTIAL_GUIDE;
  /** Sound effects (with when to use each), voice presets, volume automation and how they mix. */
  audio: AudioCatalog;
  /** Footage editing: fits, focus, speed-ramp presets, clip range and freeze frames, plus take editing
   * (look strength, user LUTs, trimSilence/keep, cutaways, probed traits) under `take`. */
  footage: FullFootageCatalog;
  starter: typeof STARTER;
  /** One story, several formats: `formats` overrides, `$format` values, merge rules (core/formats). */
  formats: typeof FORMATS_GUIDE;
  /** HTML layers (`inputs[].type: "html"`): the supported subset and layout recipes. */
  html: HtmlCatalog;
}

const BASIC_TRANSITIONS: Record<string, string> = {
  cut: 'A hard cut: free to render, lands on the beat.',
  fade: 'A crossfade between the two scenes.',
  fadeblack: 'Dips through black: a chapter break.',
  dissolve: 'A grainy, organic dissolve.',
};

const GRAPHICS: Record<string, string> = {
  flash: 'Full-frame light hit that decays (at, duration, color, intensity).',
  bars: 'Cinema letterbox bars slide in (aspect).',
  underline:
    'A rule that draws itself (x, y, width, thickness, origin), caps round, settle (overshoot), exit; ' +
    'drawn above text by default (CTA-safe).',
  frame:
    'A rectangle outline tracing itself clockwise (inset, thickness), radius, trace path|split|sides|fade ' +
    'from the top-left, exit fade|retract|expand, target + clearance, contrast auto|shadow.',
  corners:
    'Viewfinder brackets extending from the corners (inset, length, thickness), target + clearance ' +
    '(default 24 px), spread (close-in), trace clockwise|together|fade, radius, exit, contrast auto|shadow.',
  wipe: 'A colour panel sweeping across the frame: covers then uncovers (direction).',
  panel: 'A solid block growing from one edge: a backing plate for text (x, y, width, height, from).',
  glitch: 'A seeded digital tear: RGB split, jitter, grain and colour slices for a short hit (intensity).',
  focus:
    'Rack focus: the frame blurs in or out of focus (direction in|out, amount). above: false keeps later text sharp.',
  progress: 'A bar that fills over a window, then holds (position, thickness, track, x, y, width; linear by default).',
  ticker: 'A news band grows in, then copy scrolls right to left and loops (text, speed, position, height, font).',
  'bars-chart':
    'Bars grow one after another while their values count up (values, labels, max, x, y, width, height, stagger).',
  fx: 'A procedural light primitive clipped to a target, composed from open parameters (effect, target, …): see fx.',
};

const LOWER_THIRDS: Record<string, string> = {
  band: 'Default (no style): a full-width translucent band, accent bar, title, subtitle and badge.',
  'clean-bar': 'Tight boxes behind each line under an accent rule that draws itself; slides in.',
  'side-rule': 'No band: a vertical accent rule grows beside the lines, which slide in.',
  kicker: 'The subtitle becomes an accent label above the title, then a rule underlines the title.',
  'stack-bars': 'Title on an accent box, subtitle on a band box, sliding in one after the other.',
  pill: 'A rounded pill grows from a dot; title and subtitle fade in inside it.',
};

const TRAIL = {
  description:
    'kinetic[].trail: each unit leaves fading echoes of itself a few frames behind while it moves; they collapse into it when it rests.',
  fields: ['echoes (2..6)', 'delta (s, default 0.04)', 'fade (0..1, default 0.5)'],
  verb: 'SMEARS',
  useWhen: 'fast travel that should feel kinetic: impact, drop, slide, split on a hype beat',
  avoidWhen: 'calm presets (fade, typewriter), long copy, or premium tone',
  pairsWith: ['whip transition', 'camera hits'],
};

function guided(descriptions: Record<string, string>, guides: Record<string, MotionGuide>) {
  return Object.fromEntries(
    Object.entries(descriptions).map(([name, description]) => [name, { description, ...guides[name] }])
  );
}

export function motionCatalog(): MotionCatalog {
  return {
    rules: ART_DIRECTION,
    doctrine: GENRE_DOCTRINE,
    blueprints: MOTION_BLUEPRINTS,
    kinetic: {
      presets: kineticCatalog().map((entry) => ({ ...entry, ...KINETIC_GUIDES[entry.preset] })),
      exits: KINETIC_EXIT_PRESETS,
      orders: KINETIC_ORDERS,
      units: ['line', 'word', 'glyph'],
      trail: TRAIL,
    },
    compositing: COMPOSITING,
    easing: {
      historical: LEGACY_EASINGS,
      named: [...Object.keys(CSS_BEZIERS), ...Object.keys(NAMED_CURVES)],
      functions: [
        'cubic-bezier(x1, y1, x2, y2)',
        'spring(stiffness, damping[, mass[, velocity]])',
        'steps(count[, start|end])',
        '{ "points": [[0,0],[0.4,1.08],[1,1]] }',
        '$token',
      ],
      springRules: `stiffness 1..2000, damping 1..200, mass 0.1..20, velocity -50..50, damping ratio ≥ ${MIN_DAMPING_RATIO}; with no duration a spring takes its own settle time.`,
    },
    camera: {
      presets: CAMERA_PRESETS.map((preset) => ({ preset, ...CAMERA_GUIDES[preset] })),
      fields: [
        'preset',
        'amount',
        'delay',
        'duration',
        'ease',
        'zoom[]',
        'x[]',
        'y[]',
        'rotate[]',
        'hits[]',
        'shake',
        'includeText',
      ],
    },
    transitions: guided({ ...BASIC_TRANSITIONS, ...DESIGNED_TRANSITION_DESCRIPTIONS }, TRANSITION_GUIDES),
    graphics: guided(GRAPHICS, GRAPHIC_GUIDES),
    fx: fxCatalog(),
    samples: samplesCatalog(),
    lowerThirds: guided(LOWER_THIRDS, LOWER_THIRD_GUIDES),
    tokens: BUILTIN_MOTION_TOKENS,
    roles: motionRolesCatalog(),
    platforms: platformCatalog(),
    themes: themeCatalog(),
    captions: captionCatalog(),
    timing: TIMING,
    partials: PARTIAL_GUIDE,
    audio: audioCatalog(),
    footage: fullFootageCatalog(),
    starter: STARTER,
    formats: FORMATS_GUIDE,
    html: htmlCatalog(),
  };
}
