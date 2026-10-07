import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

// Surfaces in clients (e.g. Claude Desktop) as a `/compose-video` affordance. It primes the agent
// to author a PREMIUM, deterministic, on-device-safe template and to iterate with validate_template
// before the slower compose_video render.
const argsSchema = z.object({
  goal: z
    .string()
    .optional()
    .describe('What to make, e.g. "a 15s premium title card for Emily Parker, Frontend Developer".'),
  orientation: z
    .enum(['landscape', 'portrait', 'square'])
    .optional()
    .describe('landscape (16:9), portrait (9:16) or square (1:1).'),
  creativeDirection: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .optional()
    .describe(
      'Visual brief: audience, hierarchy, typography, palette, motion, pacing, avoidances and review criteria.'
    ),
});

type GuideArgs = z.infer<typeof argsSchema>;

// On-device FFmpeg is an LGPL build (scripts/ffmpeg/common.sh, --disable-gpl). Authoring against this
// set keeps the output identical across React Native, browser WASM, and the server. GPL filters (eq,
// boxblur, geq) are absent — the engine auto-remaps `eq`→`lutyuv` and blur is `gblur` — so prefer the
// structured `grade`/`look`/`motion` fields below over raw GPL filters.
const ON_DEVICE_FILTERS =
  'scale, crop, pad, format, fps, trim, setpts, fade, drawtext, overlay, concat, xfade, loop, tile, ' +
  'drawbox, gblur, hue, vignette, hflip, vflip, rotate, transpose, negate, colorchannelmixer, ' +
  'colorbalance, curves, zoompan, lutyuv, sidechaincompress, aresample, aformat, amix, afade, ' +
  'acrossfade, afftdn, volume, color, sine, gradients';

const BUNDLED_FONTS = 'BebasNeue, Oswald, PlayfairDisplay, Pacifico, Rubik, RobotoMono';

// Pacing rules a motion director applies; validate_template's `motionWarnings` checks most of them.
const MOTION_RULES = [
  'Motion rules (get_motion_catalog has the genre doctrine, blueprints and a verb per preset):',
  "  - Compose, don't pick: creative direction (audience, brand, energy) → a motion intent per section → engine",
  '    primitives (kinetic, animate tracks + ease tokens/springs, camera, designed transitions, graphics, fx) → tune',
  '    their parameters (never all defaults). One or two signature moves per video, not one per section.',
  '  - Library animations (animations/*.apng: shine sweep, confetti, light leak…) are samples: a last resort;',
  '    get_motion_catalog → samples names the primitives that replace each one.',
  '  - One primary transition plus 1–2 accents for key moments; cut between beats of the same idea.',
  '  - The transition is the exit: no element exit in the last 0.3 s before a non-cut boundary.',
  "  - Don't start at 0: offset each section's first text entrance 0.1–0.3 s after the cut.",
  '  - Vary eases by role (spring hero, smooth support, linear draws); never one curve for every element.',
  '  - Vary tempo: the slowest beat runs at least 3× the fastest; no beat sits still for 2.5 s or more.',
  '  - Every element has a verb (SLAMS, TYPES, DRAWS, LEANS IN); two of the same verb in one beat compete.',
  '  - Product launches reveal sequentially through the back half of a beat, on smooth curves, no overshoot.',
  '  - Pin the intent with section `assert` (visibleBy, before, inFrame, keepsMoving) and fix motionWarnings.',
];

function buildText(args: GuideArgs): string {
  const goal = args.goal?.trim() ? args.goal.trim() : 'the video the user describes';
  const orientation =
    args.orientation ?? 'the orientation the user wants (landscape 16:9, portrait 9:16 or square 1:1)';

  return [
    'Compose video with explicit LeClap JSON settings. Native scenes run on phone, browser and Node;',
    'registered Remotion effects require the configured Node/Chromium backend. Pin source, props, assets',
    'and runtime for repeatable rendering; encoder differences can change bytes across backends.',
    '',
    `Goal: ${goal}. Orientation: ${orientation}.`,
    `Creative direction: ${args.creativeDirection?.trim() ?? 'Derive a brief from the user goal and verified assets.'}`,
    '',
    'Workflow:',
    '1. Discover examples with list_samples (category/backend/query), then get_sample by stable ID.',
    '   Read creativeDirection and requirements: named clips/durations/capture hints, form fields/limits,',
    '   variables/defaults/placeholders, assets/fonts and registered effects/setup. Discovery is available',
    '   even when Remotion is disabled; preview media is not bundled. Retrieved template JSON embeds partials.',
    '2. Call get_template_schema for the authoritative shape, then customize the retrieved template or author',
    '   a fresh descriptor for the goal. Supply your own media via userVideoPaths and copy via fields or',
    '   global.variables; replace authored asset references as needed. Store the brief in meta.creativeDirection:',
    '   audience, hierarchy, typography, palette, motion, pacing, avoidances and review criteria.',
    '   For animated copy, camera moves and designed transitions call get_motion_catalog: section `kinetic` blocks give',
    '   native per-word/per-glyph choreography (presets, springs, accents, exits) on every backend.',
    '3. Translate the direction into explicit sections, filters and effect props. Choose a dominant element',
    '   per scene and vary layouts according to purpose. Native samples use FFmpeg; registered effects need',
    '   allowRemotion, Remotion peers and a trusted configured entry. customCatalog:true effects also need an',
    '   operator effect catalog and matching composition; exported JSON supplies no executable source.',
    '4. Inspect the exact registered ID/version with get_effect_schema before editing props. Call',
    '   validate_template (no render) and fix issues + confirm required clips/fields before composition;',
    '   read its geometry and motionWarnings findings and apply their hints.',
    '5. For registered scenes inspect render_preview at entrance, settling and ending. For native scenes',
    '   call render_frames after validate to look at the result (atTransitions + perSection, sheet for one',
    '   image); check safe zones with `safe: <platform>` and compare options with `variants` or `looks`.',
    '   get_timeline gives section starts, motion events and beats to pick moments ("title.end", "beat:8").',
    '   Fix collisions, crop, copy, contrast and pacing before the final compose_video export.',
    '   No catalog entry for a need? get_motion_catalog { query } ranks matches; on a `gap`, call',
    '   report_catalog_gap.',
    '',
    ...MOTION_RULES,
    '',
    'Premium animated intro (bring your own Remotion): if you have a Remotion project, call',
    'render_remotion_clip with its entry + a compositionId (+ optional inputProps) for motion graphics the',
    'FFmpeg filtergraph cannot produce — it returns an mp4 clip path. Add a leading { type: "project_video",',
    'name: "intro" } section and pass that path via compose_video\'s userVideoPaths.intro, so FFmpeg composites',
    'the Remotion intro in front of your scenes. It needs @remotion/* (optional) and is a design-time render',
    '(headless Chromium), not an on-device path; everything else stays on-device.',
    '',
    'Premium building blocks — PREFER the structured fields (they lower to on-device-safe filters and',
    'stay legible) over hand-rolled filtergraphs:',
    '  - text: `titleCard` / `lowerThird` / `caption` sugar with `accent`, `reveal` ("rise"/"fade"),',
    '    and `effect: { shadow, outline }` — a staged, on-brand reveal without writing `alpha` expressions.',
    '    Use `reveal.easing: "ease-out-back"` for one small headline overshoot; keep travel modest and leave room.',
    '    Keep instructional motion calm. The optional editorial catalog adds blur-rise, split-slide and elastic-stagger;',
    '    discover its exact props before choosing per-word Remotion motion (Node worker only).',
    '  - colour: a section `look` (named preset, e.g. "cinematic"/"warm-film"/"teal-orange") plus a manual',
    '    `grade` — `colorBalance` (shadows/midtones/highlights r/g/b) and `curvesPreset` (e.g.',
    '    "increase_contrast", "vintage") are LGPL and run everywhere.',
    '  - motion: a section `motion` array — `kenburns` (direction+intensity push-in), `rotate`, `flip`,',
    '    `crop`. Per-section `options.speed` retimes a clip (2 = half-speed slow-mo, 0.5 = 2× fast).',
    '  - audio: `global.audio` with `musicVolume`, `normalize: "loudnorm"`, and `ducking`',
    '    ({ threshold, ratio, attack, release }) so music dips under speech — on-device-safe.',
    '    `options.voice: "clean"` on recorded sections, `sfx: [{ id: "hit", at: "title.end" }]` on the',
    '    moments that land, or `global.audio.sfx: "auto"`; `global.audio.automation` swells the music bed.',
    '  - background: full-frame `drawbox` (t:fill) for a solid base, layered band drawboxes or `gradients`',
    '    for depth, `vignette` for a cinematic edge.',
    '  - motion between clips: `xfade`; per-clip in/out: `fade`.',
    '  - raw-filter escape hatch (LGPL on-device allowlist, use only these when you must hand-roll):',
    `    ${ON_DEVICE_FILTERS}`,
    '  - NOT available on-device (GPL, dropped by --disable-gpl): `eq` (auto-remapped to `lutyuv`) and',
    '    `boxblur` (use `gblur`) and `geq`. Prefer the allowlist above; perspective has a flat mobile fallback.',
    `  bundled fonts (bare names, no path): ${BUNDLED_FONTS}.`,
    '',
    'Portrait is 720x1280 (9:16); landscape is 1280x720 (16:9); square is 1080x1080 (1:1). project_video sections need a user clip',
    'supplied at compose time; color/text-only templates need no upload at all.',
  ].join('\n');
}

export function registerComposeGuide(server: McpServer): void {
  server.registerPrompt(
    'compose-video',
    {
      title: 'Compose a premium video',
      description:
        'Guided authoring for a premium, deterministic, on-device-safe LeClap template — primes the ' +
        'schema, the premium filter/typography recipes, and the validate→compose loop.',
      argsSchema,
    },
    (args: GuideArgs) => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: buildText(args) },
        },
      ],
    })
  );
}
