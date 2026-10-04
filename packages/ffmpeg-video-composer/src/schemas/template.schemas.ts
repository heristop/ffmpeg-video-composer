import { z } from 'zod';
import { TemplateDescriptorSchema, type SectionSchema, type InputSchema } from './section.schemas';
import type { TemplatePartialSchema } from './partial.schemas';
import type { FilterSchema, MapSchema } from './filter.schemas';
import type {
  GlobalConfigSchema,
  VariablesSchema,
  TranslationSchema,
  MusicConfigSchema,
  WatermarkSchema,
} from './global.schemas';
import type {
  TransitionSchema,
  GlobalAudioSchema,
  GradeSchema,
  MotionEffectSchema,
  BackgroundLayerSchema,
  FramingGuideSchema,
} from './effects.schemas';

export * from './effects.schemas';
export * from './effect-reference.schema';
export * from './global.schemas';
export * from './filter.schemas';
export * from './section.schemas';
export * from './partial.schemas';

// ── JSON Schema export ─────────────────────────────────────────────────────────

export const templateDescriptorJsonSchema = z.toJSONSchema(TemplateDescriptorSchema);

// ── TypeScript types ───────────────────────────────────────────────────────────

export type TemplateDescriptor = z.infer<typeof TemplateDescriptorSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type TemplatePartial = z.infer<typeof TemplatePartialSchema>;
export type Filter = z.infer<typeof FilterSchema>;
export type Map = z.infer<typeof MapSchema>;
export type Input = z.infer<typeof InputSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type Variables = z.infer<typeof VariablesSchema>;
export type Translation = z.infer<typeof TranslationSchema>;
export type MusicConfig = z.infer<typeof MusicConfigSchema>;
export type Watermark = z.infer<typeof WatermarkSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type GlobalAudio = z.infer<typeof GlobalAudioSchema>;
export type Grade = z.infer<typeof GradeSchema>;
export type MotionEffect = z.infer<typeof MotionEffectSchema>;
export type BackgroundLayer = z.infer<typeof BackgroundLayerSchema>;
export type FramingGuide = z.infer<typeof FramingGuideSchema>;
