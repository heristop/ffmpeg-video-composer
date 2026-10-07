import { z } from 'zod';
import { MAX_SEED } from '../core/determinism/contract';
import { EMOJI_MODES } from '../core/emoji-assets';
import { MotionTokensSchema } from './motion.schemas';
import { ThemeSchema } from './theme.schemas';
import { BeatsSchema } from './time.schemas';
import { GlobalSfxSchema } from './audio.schemas';
import { FieldsSchema } from './fields.schemas';
import {
  TransitionSchema,
  GlobalAudioSchema,
  GradeSchema,
  LookSchema,
  OverlayFitSchema,
  OverlayFlipSchema,
  RevealSchema,
  TextEffectSchema,
} from './effects.schemas';
import { PLATFORM_NAMES } from '../core/platforms';

export const TranslationSchema = z
  .record(z.string(), z.string())
  .describe('Locale-keyed map of translated strings, e.g. { en: "Hello", fr: "Bonjour" }.');

// How a font is named anywhere in a descriptor. A string is a bundled registry id or a raw .ttf
// filename, both resolved locally. The object form names a family that is resolved on demand, and is
// deliberately a DIFFERENT SHAPE rather than another string: it keeps a typo'd registry id ("bebbas")
// a local validation error instead of turning it into a network lookup that fails mid-render.
//
// The weight is constrained to the 100..900 steps Google Fonts serves, so an unservable weight is
// caught at author time rather than surfacing as a failed download. `multipleOf` (not a refine) so the
// step also reaches the generated JSON Schema that schema-driven authors (MCP, editors) validate with.
export const FontRefSchema = z
  .object({
    family: z.string().trim().min(1).describe('Font family name as Google Fonts spells it, e.g. "Playfair Display".'),
    weight: z
      .number()
      .int()
      .min(100)
      .max(900)
      .multipleOf(100, { message: 'weight must be a multiple of 100' })
      .optional()
      .describe('Font weight 100..900 in steps of 100 (default 400).'),
    style: z.enum(['normal', 'italic']).optional().describe('Font style (default normal).'),
  })
  .strict();

export const FontInputSchema = z.union([z.string(), FontRefSchema]);

// A whole-video text overlay (e.g. a brand watermark) authored once in global and composited onto
// every section — the text sibling of global.animations. Lowered by the global-decorations preset.
export const GLOBAL_TEXT_POSITIONS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'top',
  'bottom',
  'center',
] as const;

export const GlobalTextOverlaySchema = z
  .object({
    text: TranslationSchema.describe('Localised text drawn over every section (e.g. a brand name).'),
    position: z.enum(GLOBAL_TEXT_POSITIONS).optional().describe('Anchor for the text (default top-right).'),
    font: FontInputSchema.optional().describe(
      'Font id, .ttf filename, or { family, weight, style } for any Google Fonts family (default Oswald).'
    ),
    size: z.number().positive().optional().describe('Font size in px; default derived from the output height.'),
    color: z.string().optional().describe('Text colour as a CSS hex string (default white).'),
    opacity: z.number().min(0).max(1).optional().describe('Static text alpha 0..1 when no reveal is set (default 1).'),
    reveal: RevealSchema.optional().describe('Animated entrance for the text (default none).'),
    effect: TextEffectSchema.optional().describe('Drop shadow / outline for legibility over every section.'),
    sections: z.array(z.string()).optional().describe('Section names this overlay appears on; omit for every section.'),
  })
  .strict()
  .describe('A whole-video text overlay composited onto every section (or a named subset).');

export const MusicConfigSchema = z
  .object({
    name: z.string().describe('Human-readable name of the music track.'),
    url: z.string().optional().describe('URL of the music file; omit to use an app-managed track.'),
  })
  .describe('Music track reference used in global.music.');

export const VariablesSchema = z
  .record(z.string(), z.union([z.string(), z.array(z.string())]))
  .describe('Named variables injected into filter values and URLs via {{ varName }} syntax.');

// A whole-video animation overlay: composited once over the FINAL joined video (after sections are
// concatenated, before music), so it spans every section continuously — unlike a section input which
// restarts each section. Same placement/playback options as a section animation input, minus name/type.
export const GlobalAnimationSchema = z
  .object({
    url: z
      .string()
      .describe(
        'URL or file path of the overlay — an animated single-file format (.apng/.webp/.gif/.webm), stream-looped, ' +
          'or a still raster image (.png/.jpg/.jpeg), held with -loop 1 for the whole video; may use {{ varName }}.'
      ),
    position: z.string().optional().describe('Overlay position as "x:y" in output pixels (e.g. "0:0" top-left).'),
    scale: z.string().optional().describe('Scale expression applied to the overlay before compositing, as "w:h".'),
    fit: OverlayFitSchema.optional(),
    opacity: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Overlay alpha from 0 (invisible) to 1 (opaque); 1 (or omitted) keeps it fully opaque.'),
    rotation: z
      .number()
      .optional()
      .describe('Clockwise rotation in degrees applied to the overlay before compositing.'),
    flip: OverlayFlipSchema.optional(),
    loop: z
      .boolean()
      .optional()
      .describe('When true, the overlay loops continuously for the whole video duration (default false).'),
    loops: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Number of times the overlay plays (finite). Takes precedence over loop; omit for loop/once.'),
    duration: z
      .number()
      .positive()
      .optional()
      .describe(
        'Seconds the overlay plays before it ends (loops the source to fill). Takes precedence over loops/loop.'
      ),
    start: z
      .number()
      .positive()
      .optional()
      .describe('Seconds to delay the overlay before it appears (via -itsoffset); 0/omitted starts at the beginning.'),
    persistent: z
      .boolean()
      .optional()
      .describe(
        'When true, the overlay freezes its last frame once it ends instead of letting the video show through.'
      ),
    motion: RevealSchema.optional().describe(
      'Animated entrance for the overlay: rise/slide in via overlay x/y expressions, or an alpha fade-in on the overlay leg.'
    ),
  })
  .strict()
  .describe('A single whole-video animation overlay composited over the final joined video.');

// A still-image watermark composited over the whole video (e.g. a logo) — pure sugar that lowers into
// a global.animations entry (see editor/presets/watermark.ts) so it reuses the whole-video overlay
// pipeline untouched.
export const WATERMARK_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export const WatermarkSchema = z
  .object({
    url: z.string().describe('URL or path of the watermark image (png/jpg); may use {{ varName }}.'),
    position: z
      .enum(WATERMARK_POSITIONS)
      .optional()
      .describe('Corner the watermark is anchored to (default bottom-right).'),
    scale: z
      .number()
      .min(0.02)
      .max(0.5)
      .optional()
      .describe('Watermark width as a fraction of the output width, 0.02..0.5 (default 0.12).'),
    opacity: z.number().min(0).max(1).optional().describe('Watermark alpha, 0..1 (default 0.8).'),
    margin: z
      .number()
      .int()
      .min(0)
      .max(200)
      .optional()
      .describe('Inset from the frame edges in output pixels, 0..200 (default 24).'),
  })
  .strict()
  .describe('A still-image watermark composited over the whole video (e.g. a logo).');

// ── global config ──────────────────────────────────────────────────────────────

export const OrientationSchema = z
  .enum(['landscape', 'portrait', 'square'])
  .describe(
    'Output video orientation; controls the resolution preset — landscape 1280x720, portrait 720x1280, square 1080x1080 (default: landscape).'
  );

export type Orientation = z.infer<typeof OrientationSchema>;

export const PlatformSchema = z
  .enum(PLATFORM_NAMES)
  .describe(
    'Delivery platform the video is made for: tiktok, reels (aliases ig, instagram), shorts (aliases ' +
      'yt-shorts, youtube-shorts), youtube, x (alias twitter), linkedin, facebook or square-feed. Sets the ' +
      'default orientation when global.orientation is omitted (portrait for tiktok/reels/shorts, square for ' +
      'square-feed, landscape otherwise); validation then warns about text under the app UI (per-edge safe ' +
      'zones, e.g. the bottom 22% under TikTok captions), a timeline longer than the platform accepts and an ' +
      'unusual fps; the default caption position is lifted clear of the bottom UI; and loudnorm targets the ' +
      'platform loudness (-14 LUFS, -1 dBTP). Rendering is otherwise unchanged.'
  );

export const GlobalConfigSchema = z
  .object({
    variables: VariablesSchema.optional().describe(
      'Template-wide variable definitions referenced via {{ varName }} syntax.'
    ),
    fields: FieldsSchema.optional(),
    orientation: OrientationSchema.optional(),
    platform: PlatformSchema.optional(),
    emoji: z
      .enum(EMOJI_MODES)
      .optional()
      .describe(
        'How colour emoji in drawn text render (drawtext itself only draws monochrome outlines). "image" ' +
          '(default): each emoji leaves the text, a measured gap takes its place and a bundled colour image ' +
          "(~250 common emoji, skin tones and flags included) is composited there, sharing the text's timing, " +
          'motion and fades; an emoji with no bundled image is stripped with an emoji_missing_asset warning, and ' +
          'at most 24 images are composited per section. "strip": remove emoji silently (warning only). "error": ' +
          'fail validation with emoji_unsupported.'
      ),
    seed: z
      .number()
      .int()
      .min(0)
      .max(MAX_SEED)
      .optional()
      .describe(
        'Root seed (uint32, default 0) for every procedural effect: each element derives its own stream as ' +
          'hash(seed, element path), so the same seed always renders the same shake, grain and scramble.'
      ),
    motion: MotionTokensSchema.optional(),
    theme: ThemeSchema.optional(),
    beats: BeatsSchema.optional(),
    fps: z
      .number()
      .int()
      .min(1)
      .max(120)
      .optional()
      .describe('Output frame rate for the rendered video (integer 1..120, default 30).'),
    colorsList: z
      .array(z.string())
      .optional()
      .describe('Palette of colours offered to the user for customisation, as CSS hex strings.'),
    musicEnabled: z
      .boolean()
      .optional()
      .describe('Whether background music is enabled for this template (default true).'),
    transition: TransitionSchema.optional().describe(
      'Default transition applied between sections when no per-section transition is set.'
    ),
    audio: GlobalAudioSchema.optional().describe('Global audio mix settings (volumes, normalisation, ducking).'),
    sfx: GlobalSfxSchema.optional(),
    music: MusicConfigSchema.optional().describe('Default background music track for the template.'),
    animations: z
      .array(GlobalAnimationSchema)
      .optional()
      .describe('Whole-video animation overlays composited over the final joined video, spanning all sections.'),
    overlays: z
      .array(GlobalTextOverlaySchema)
      .optional()
      .describe('Whole-video text overlays (e.g. a brand watermark) composited onto every section.'),
    watermark: WatermarkSchema.optional().describe(
      'A still-image watermark (e.g. a logo) composited over the whole video, authored once per template.'
    ),
    look: LookSchema.optional().describe(
      'Colour-grade preset applied across every section (whole-video look); string or { preset, strength }.'
    ),
    grade: GradeSchema.optional().describe('Fine-grained colour grade applied across every section.'),
    allowedMusic: z
      .array(z.string())
      .optional()
      .describe('Allowlist of music track identifiers the user may choose from.'),
    allowUploadMusic: z
      .boolean()
      .optional()
      .describe('Whether the user is allowed to upload a custom music file (default false).'),
    allowedBackgrounds: z
      .array(z.string())
      .optional()
      .describe('Allowlist of background asset identifiers the user may choose from.'),
    allowUploadBackground: z
      .boolean()
      .optional()
      .describe('Whether the user is allowed to upload a custom background image (default false).'),
  })
  .strict()
  .describe('Template-wide configuration applied as defaults across all sections.');
