import { declaredFields, type TemplateDescriptor } from 'ffmpeg-video-composer';
import { z } from 'zod';

// Values for a template's fields as an agent passes them: the declared `global.fields` take typed values
// (a number for a number field), form fields take text. The engine coerces each one by its declared type.
export const fieldsArg = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe('Values for global.fields and form fields, by name (validate_template lists them).');

export type FieldArgs = z.infer<typeof fieldsArg>;

/** The engine's ProjectConfig.fields: every value as the text the CLI would pass. */
export function fieldValues(fields: FieldArgs): Record<string, string> | undefined {
  if (!fields) return undefined;

  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, String(value)]));
}

export const fieldContractSchema = z
  .array(
    z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      default: z.union([z.string(), z.number()]).optional(),
    })
  )
  .optional()
  .describe('The declared global.fields: what compose_video `fields` fills (typed; a default makes it optional).');

export type FieldContract = z.infer<typeof fieldContractSchema>;

/** The declared field contract, or undefined when the template declares none (the key then disappears). */
export function fieldContract(descriptor: TemplateDescriptor): FieldContract {
  const fields = declaredFields(descriptor.global);

  if (fields.length === 0) return undefined;

  return fields.map((field) => ({
    name: field.name,
    type: field.type,
    required: field.required === true,
    ...(field.default === undefined ? {} : { default: field.default }),
  }));
}
