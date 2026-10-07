import { z } from 'zod';

// The template's typed input contract (core/fields). Descriptions stay short: the web AI prompt embeds the
// JSON schema under a tight size budget.

export const FIELD_TYPES = ['text', 'color', 'url', 'media', 'number', 'enum', 'time'] as const;

export const FIELD_NAME_PATTERN = /^\w+$/;

const Translated = z.record(z.string(), z.string());

const FieldSpecShape = {
  type: z.enum(FIELD_TYPES),
  default: z.union([z.string(), z.number()]).optional(),
  required: z.boolean().optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string()).min(1).optional().describe('enum values'),
  label: Translated.optional(),
  description: z.string().optional(),
};

function enumHasOptions(spec: { type: string; options?: string[] }): boolean {
  return spec.type !== 'enum' || (spec.options?.length ?? 0) > 0;
}

const ENUM_OPTIONS = { message: 'an enum field needs options', path: ['options'] };

export const FieldSpecSchema = z.object(FieldSpecShape).strict().refine(enumHasOptions, ENUM_OPTIONS);

export const NamedFieldSchema = z
  .object({ name: z.string().regex(FIELD_NAME_PATTERN), ...FieldSpecShape })
  .strict()
  .refine(enumHasOptions, ENUM_OPTIONS);

export const FieldsSchema = z
  .union([z.record(z.string().regex(FIELD_NAME_PATTERN), FieldSpecSchema), z.array(NamedFieldSchema)])
  .describe('Typed inputs filled into {{ name }}; a whole-string placeholder takes the typed value.');

export type FieldType = (typeof FIELD_TYPES)[number];
export type FieldSpec = z.infer<typeof FieldSpecSchema>;
export type TemplateField = z.infer<typeof NamedFieldSchema>;
export type FieldsDeclaration = z.infer<typeof FieldsSchema>;
