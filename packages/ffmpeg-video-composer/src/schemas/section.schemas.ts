import { z } from 'zod';
import { EffectReferenceSchema } from './effect-reference.schema';
import { TemplatePartialSchema } from './partial.schemas';
import {
  AudioFadeSchema,
  BackgroundLayerSchema,
  ChromaKeySchema,
  FramingGuideSchema,
  GradeSchema,
  LOOK_PRESETS,
  MotionEffectSchema,
  TransitionSchema,
} from './effects.schemas';
import { TranslationSchema, GlobalConfigSchema } from './global.schemas';
import { FilterSchema, MapSchema } from './filter.schemas';
import { CaptionSchema, TitleCardSchema, LowerThirdSchema } from './text.schemas';
import { InputSchema, FieldSchema } from './section-media.schemas';

export {
  CAPTION_STYLES,
  CAPTION_POSITIONS,
  CAPTION_ALIGNS,
  CaptionSchema,
  TitleCardSchema,
  LowerThirdSchema,
  type Caption,
} from './text.schemas';

// Input/shape/field media primitives live in a sibling for the max-lines budget; re-exported here so
// importers keep a single `section.schemas` entry point, and Input/Field imported back for the
// section option/base schemas below.
export { InputOptionsSchema, ShapeSpecSchema, InputSchema, FieldSchema } from './section-media.schemas';

// ── section options ────────────────────────────────────────────────────────────

export const BaseSectionOptionsSchema = z
  .object({
    upperCase: z
      .boolean()
      .optional()
      .describe('When true, all text values in this section are rendered in upper case (default false).'),
    lowerCase: z
      .boolean()
      .optional()
      .describe('When true, all text values in this section are rendered in lower case (default false).'),
    useVideoSection: z
      .string()
      .optional()
      .describe(
        'Name of a project_video section whose recorded clip is reused in this section instead of capturing a new one.'
      ),
    duration: z
      .number()
      .positive()
      .optional()
      .describe('Fixed duration of the section in seconds; overrides clip length.'),
    musicVolume: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Per-section music volume override, 0..1; overrides global.audio.musicVolume for this section.'),
    audioFade: z
      .object({
        in: AudioFadeSchema.optional().describe('Fade-in applied at the start of the section audio.'),
        out: AudioFadeSchema.optional().describe('Fade-out applied at the end of the section audio.'),
      })
      .optional()
      .describe('Audio fade-in/out applied to this section.'),
    audioEffect: z
      .enum(['echo', 'telephone', 'muffled'])
      .optional()
      .describe('Voice effect applied to the section audio: echo (aecho), telephone band-pass, or muffled low-pass.'),
    fields: z.array(FieldSchema).optional().describe('Form fields defined for this section (used in form sections).'),
    speed: z
      .number()
      .positive()
      .optional()
      .describe('Playback speed multiplier applied to the section clip (default 1).'),
    muteSection: z
      .boolean()
      .optional()
      .describe('When true, the source audio of this section is silenced (default false).'),
    countdown: z
      .boolean()
      .optional()
      .describe('When true, a countdown overlay is shown before recording starts (default false).'),
    countdownDuration: z
      .number()
      .positive()
      .optional()
      .describe('Duration of the countdown in seconds (default 3); only used when countdown is true.'),
    videoUrl: z.string().optional().describe('URL of a pre-recorded video asset used as the section clip.'),
    logoUrl: z.string().optional().describe('URL of a logo image composited into the section.'),
    backgroundUrl: z
      .string()
      .optional()
      .describe('URL of a background image or video composited behind the section content.'),
    backgroundColor: z.string().optional().describe('Solid background colour as a CSS hex string (e.g. "#000000").'),
    pictureUrl: z.string().optional().describe('URL of a picture asset used as the section background or overlay.'),
    forceAspectRatio: z
      .boolean()
      .optional()
      .describe('Cover-crop the clip to fill the output frame, never stretching (on by default; false skips scaling).'),
    forceOriginalAspectRatio: z
      .boolean()
      .optional()
      .describe('Preserve original aspect ratio via letterboxing (no crop); overrides cover-crop (default false).'),
  })
  .strict()
  .describe('Common options shared by all section types; variant-specific options are added via extend.');

// ── base section ───────────────────────────────────────────────────────────────

export const BaseSectionSchema = z
  .object({
    name: z.string().describe('Unique identifier for the section within the template, used in section references.'),
    inputs: z
      .array(InputSchema)
      .optional()
      .describe('Animation and image overlays composited on top of the section video, in array order.'),
    maps: z
      .array(MapSchema)
      .optional()
      .describe('Custom FFmpeg filtergraph maps overriding the default compositing pipeline.'),
    filters: z.array(FilterSchema).optional().describe('Filter chain applied to the section output stream.'),
    title: TranslationSchema.optional().describe('Localised display title shown to the user for this section.'),
    description: TranslationSchema.optional().describe(
      'Localised description shown to the user to explain what to record or fill in.'
    ),
    transition: TransitionSchema.optional().describe(
      'Transition applied after this section; overrides global.transition.'
    ),
    caption: CaptionSchema.optional().describe('Styled on-screen caption rendered as a drawtext filter.'),
    lowerThird: LowerThirdSchema.optional().describe('Title/subtitle band composited over the section clip.'),
    look: z
      .enum(LOOK_PRESETS)
      .optional()
      .describe('Named colour-grade preset applied to the section video (default: none).'),
    grade: GradeSchema.optional().describe('Fine-grained colour-grade settings applied to the section video.'),
    letterbox: z
      .object({
        aspect: z.number().min(1).max(4).describe('Target aspect ratio the bars simulate (e.g. 2.39 for cinemascope).'),
        color: z.string().optional().describe('Bar colour (default black).'),
      })
      .strict()
      .optional()
      .describe('Cinemascope-style horizontal bars overlaid top and bottom to simulate a wider aspect ratio.'),
    motion: z
      .array(MotionEffectSchema)
      .optional()
      .describe('Ordered list of motion and geometric effects applied to the section video.'),
    chromaKey: ChromaKeySchema.optional().describe(
      'Background removal: key out a solid screen colour and composite over a solid background.'
    ),
  })
  .describe('Base fields shared by all section variants.');

// ── section variants ───────────────────────────────────────────────────────────

export const VideoSectionSchema = BaseSectionSchema.extend({
  type: z.literal('video').describe('Section type: renders a pre-recorded or asset-backed video clip.'),
  options: BaseSectionOptionsSchema.optional().describe('Playback and compositing options for the video section.'),
}).describe('A section that plays a pre-recorded video clip or a user-uploaded video asset.');

export const EffectSectionSchema = BaseSectionSchema.extend({
  type: z.literal('effect').describe('Section type: a versioned effect rendered to a clip before composition.'),
  name: z.string().trim().min(1).describe('Unique, nonempty section name used to bind the rendered effect clip.'),
  effect: EffectReferenceSchema.describe('Versioned effect reference with JSON properties and named assets.'),
  options: BaseSectionOptionsSchema.omit({ useVideoSection: true, videoUrl: true, pictureUrl: true })
    .extend({ duration: z.number().positive().describe('Required effect duration in seconds.') })
    .strict()
    .describe('Compositing options; effect clips cannot also select another media source.'),
})
  .strict()
  .describe('Authoring effect section; resolve with an effect backend before FFmpeg composition.');

export type EffectSection = z.infer<typeof EffectSectionSchema>;

export const CaptureModeSchema = z.enum(['front', 'back', 'screen', 'upload']);
export type CaptureMode = z.infer<typeof CaptureModeSchema>;

export const ProjectVideoSectionSchema = BaseSectionSchema.extend({
  type: z.literal('project_video').describe('Section type: captures a new video clip from the device camera.'),
  options: BaseSectionOptionsSchema.extend({
    framingGuide: FramingGuideSchema.optional().describe('Camera framing guide overlay shown in the recording UI.'),
    captureMode: CaptureModeSchema.optional().describe('Recorder mode: front/back/screen/upload (default: front).'),
    allowedCaptureModes: z
      .array(CaptureModeSchema)
      .optional()
      .describe('Modes available to the user; omit for all four. A single element locks to one mode.'),
  })
    .strict()
    .optional()
    .describe('Recording and compositing options for the project_video section.'),
}).describe('A section that records a new clip from the device camera; supports a framing guide overlay.');

export const FormSectionSchema = BaseSectionSchema.extend({
  type: z.literal('form').describe('Section type: presents a text-input form to the user.'),
  options: BaseSectionOptionsSchema.extend({
    fields: z.array(FieldSchema).optional().describe('List of user-editable text fields rendered in the form.'),
  })
    .strict()
    .optional()
    .describe('Form layout and field options.'),
}).describe('A section that collects text input from the user via a form.');

export const ColorBackgroundSectionSchema = BaseSectionSchema.extend({
  type: z.literal('color_background').describe('Section type: renders a solid or layered colour background.'),
  titleCard: TitleCardSchema.optional().describe('Structured title card (kicker/headline/subtitle) for this section.'),
  options: BaseSectionOptionsSchema.extend({
    backgroundColor: z.string().optional().describe('Primary background colour as a CSS hex string (e.g. "#000000").'),
    layers: z
      .array(BackgroundLayerSchema)
      .optional()
      .describe('Ordered list of background layers composited on top of the base colour.'),
  })
    .strict()
    .optional()
    .describe('Background and layer options for the color_background section.'),
}).describe(
  'A section that renders a solid colour or composited layer background, typically used for titles or intros.'
);

export const ImageBackgroundSectionSchema = BaseSectionSchema.extend({
  type: z.literal('image_background').describe('Section type: renders a static image as the section background.'),
  options: BaseSectionOptionsSchema.extend({
    pictureUrl: z.string().optional().describe('URL of the background image asset.'),
  })
    .strict()
    .optional()
    .describe('Image URL option for the image_background section.'),
}).describe('A section that renders a static image as its background.');

export const MusicSectionSchema = BaseSectionSchema.extend({
  type: z.literal('music').describe('Section type: a silent or audio-only section used to inject music segments.'),
  options: BaseSectionOptionsSchema.optional().describe('Duration and audio options for the music section.'),
}).describe('A section with no video content, used to pad the timeline or inject music.');

export const PartialSectionSchema = BaseSectionSchema.extend({
  type: z
    .literal('partial')
    .describe('Section type: a reference to a reusable partial, expanded into real sections before validation.'),
  name: z.string().optional().describe('Optional name for the partial reference (mainly for editor display).'),
  options: BaseSectionOptionsSchema.optional().describe('Playback and compositing options for the partial reference.'),
  ref: z.string().optional().describe('Id of a registered partial to expand in place.'),
  prefix: z
    .string()
    .optional()
    .describe('Prepended to each expanded section name, so a partial can be included more than once.'),
  sections: z
    .array(z.unknown())
    .optional()
    .describe('Inline partial sections, expanded in place — an alternative to `ref` for self-contained partials.'),
  variables: z
    .record(z.string(), z.string())
    .optional()
    .describe('Values substituted into the partial’s `{{ key }}` placeholders, so one partial serves many slots.'),
}).describe('A reference to a reusable partial (by `ref`) or an inline one (`sections`), expanded before compilation.');

export const SectionSchema = z.discriminatedUnion('type', [
  VideoSectionSchema,
  ProjectVideoSectionSchema,
  EffectSectionSchema,
  FormSectionSchema,
  ColorBackgroundSectionSchema,
  ImageBackgroundSectionSchema,
  MusicSectionSchema,
  PartialSectionSchema,
]);

export const TemplateMetaSchema = z
  .object({
    name: z.string().optional().describe('Human-readable template name for catalogs and editors.'),
    description: z.string().optional().describe('Short human-readable template summary for catalogs and agents.'),
    creativeDirection: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .optional()
      .describe(
        'Authoring brief (1..4000 characters): audience, visual hierarchy, typography, palette, motion, pacing, ' +
          'avoidances and review criteria. Guides humans/agents; never interpreted or executed by the renderer. ' +
          'Implement the direction explicitly in sections, filters and effect props.'
      ),
  })
  .strict()
  .describe('Optional human-facing metadata embedded in the descriptor; behavioral catalog fields are derived.');

export const TemplateDescriptorSchema = z
  .object({
    meta: TemplateMetaSchema.optional().describe('Optional template metadata for display and discovery.'),
    global: GlobalConfigSchema.optional().describe(
      'Template-wide defaults: variables, orientation, audio, transitions, and music.'
    ),
    sections: z
      .array(SectionSchema)
      .optional()
      .describe('Ordered list of sections that make up the video composition timeline.'),
    partials: z
      .array(TemplatePartialSchema)
      .optional()
      .describe('Reusable partials referenced by `{ type: "partial", ref }` sections; expanded before compilation.'),
  })
  .describe(
    'Root descriptor of a video composition template; all fields are optional so partial descriptors can be validated incrementally.'
  );
