import { resolveFields, type FieldValue } from '@/core/fields';
import { expandPartialsSafe } from '@/core/partials';
import { resolveFormat } from '@/core/formats/resolve';
import { BaseTemplateValidator } from './BaseTemplateValidator';
import type { ValidationError } from './validation/types';

// The descriptor a render starts from for the given values (`leclap resolve`, MCP get_resolved_template),
// built as the build builds it (director/prepare-build.ts): partials expanded, declared fields filled with
// their typed values (core/fields), then the requested format resolved. global.variables and plain form
// values stay as placeholders: the engine fills them as it draws (text; variables also colours and URLs).
// `errors` is what the render's validation would refuse with these values (strict on declared fields).

export interface ResolvedTemplate {
  descriptor: unknown;
  /** The typed value of every declared field that has one. */
  values: Record<string, FieldValue>;
  errors: ValidationError[];
}

type Values = Readonly<Record<string, unknown>>;

export function resolveTemplate(
  template: unknown,
  values: Values = {},
  options: { format?: string } = {}
): ResolvedTemplate {
  const expansion = expandPartialsSafe(template);

  if (!expansion.ok) return { descriptor: template, values: {}, errors: [expansion.error] };

  const typed = resolveFields(expansion.data, values);
  const formatted = resolveFormat(typed.descriptor, options.format).descriptor;
  const validation = new BaseTemplateValidator().validateTemplate(template, { fields: values, format: options.format });

  return { descriptor: formatted, values: typed.values, errors: validation.errors ?? [] };
}
