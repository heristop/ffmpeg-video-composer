// The schemas themselves, not template.schemas.ts: that module also builds the JSON schema (with the fx prose
// it attaches), which a browser page that only validates never needs.
import { TemplateDescriptorSchema, SectionSchema } from '../schemas/section.schemas';
import { FilterValuesSchema } from '../schemas/filter.schemas';
import type { TemplateDescriptor, Section } from '../schemas/template.schemas';
import { findUnknownKeys, type UnknownKey } from './validation/schema-walk';
import { knownNames, referenceFinding } from './validation/reference-finding';
import {
  dedupeFindings,
  unknownKeyFinding,
  valueAt,
  zodIssueFindings,
  zodIssues,
  withoutHostFields,
  type IssueSource,
} from './validation/zod-findings';
import { validateDescriptorRules, type ValidationError } from './template-validation-rules';
import { expandPartialsSafe } from '@/core/partials';
import { resolveThemeDescriptor } from '@/core/theme/resolve';
import { resolveSectionDurations } from '@/core/timing/durations';
import { validateBeatsAnalysis } from './time-ref-validation';
import { usesFormats } from '@/core/formats/resolve';
import { validateEachFormat } from './validation/format-validation';

export type { ValidationError } from './template-validation-rules';

/** `format`: validate the descriptor as it renders in that one format (default: every declared format). */
export interface ValidateOptions {
  format?: string;
}

export interface ValidationResult {
  success: boolean;
  data?: TemplateDescriptor | Section;
  errors?: ValidationError[];
}

// Raw FFmpeg filter values are forwarded key-by-key to the filter (FormatterManager), so any
// drawtext/drawbox option is legal there even when the schema does not name it.
const FREE_FORM_SCHEMAS: ReadonlySet<unknown> = new Set([FilterValuesSchema]);

// The validation a render needs: the schema parse, unknown keys and the descriptor rules, all synchronous.
// The advisory passes (pacing lint, theme accent, geometry, variable references) live on the
// TemplateValidator subclass, so the models (and through them the browser / React Native entries), which
// only validate, never statically pull in the pacing lint or reach the lazy geometry chunk.
export interface ValidatorOptions {
  /**
   * Whether the host measures `global.beats: { analyze: 'music' }` itself (the Node compile does). False
   * on the browser and on-device engines, where such a template fails with beats_analysis_unavailable.
   * Default true.
   */
  beatsAnalysis?: boolean;
}

export class BaseTemplateValidator {
  constructor(private readonly options: ValidatorOptions = {}) {}

  private formatZodError(error: IssueSource, data?: unknown, unknownKeys: UnknownKey[] = []): ValidationError[] {
    try {
      return zodIssueFindings(zodIssues(error), data, unknownKeys);
    } catch (mapError) {
      return [
        {
          path: 'format_error',
          message: mapError instanceof Error ? mapError.message : 'Error formatting Zod errors',
          code: 'format_error',
        },
      ];
    }
  }

  // Every schema finding in one pass: zod's issues plus the unknown keys a strip object dropped.
  // `envelope`: the data is a whole descriptor, whose top level hosts may extend with their own fields.
  private schemaErrors(
    schema: unknown,
    data: unknown,
    error: IssueSource | undefined,
    envelope = false
  ): ValidationError[] {
    const found = findUnknownKeys(schema, data, { freeForm: FREE_FORM_SCHEMAS });
    const unknownKeys = envelope ? withoutHostFields(found) : found;
    const issues = error ? this.formatZodError(error, data, unknownKeys) : [];
    const keyFindings = unknownKeys.map((entry) =>
      unknownKeyFinding(entry.path.join('.'), entry.key, entry.allowed, valueAt(data, entry.path))
    );

    return dedupeFindings([...issues, ...keyFindings]);
  }

  private validateSectionReferences(template: TemplateDescriptor): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!template.sections || !Array.isArray(template.sections)) {
      return errors;
    }

    const sectionNames = new Set(template.sections.map((section) => section.name));

    for (let index = 0; index < template.sections.length; index++) {
      const section = template.sections[index];

      if (section.type !== 'effect' && section.options?.useVideoSection) {
        const referencedSection = section.options.useVideoSection;

        if (!sectionNames.has(referencedSection)) {
          errors.push(
            referenceFinding(
              `sections[${index}].options.useVideoSection`,
              `Referenced section "${referencedSection}" does not exist`,
              'undefined_section_reference',
              { name: referencedSection, known: knownNames(sectionNames), fix: 'point it at an existing section name' }
            )
          );
        }
      }
    }

    return errors;
  }

  validateTemplate(templateData: unknown, options: ValidateOptions = {}): ValidationResult {
    // Expand `{ type: "partial", ref }` sections to real sections first, so the schema + reference
    // checks (and the engine downstream) only ever see real sections.
    const expansion = expandPartialsSafe(templateData);

    if (!expansion.ok) {
      return { success: false, errors: [expansion.error] };
    }

    if (usesFormats(expansion.data) || options.format !== undefined) {
      return this.validateFormats(expansion.data, options.format);
    }

    return this.validateParsed(expansion.data);
  }

  // One story, several formats: each format is validated as the descriptor it renders
  // (validation/format-validation.ts); `data` stays the authored descriptor, formats included.
  private validateFormats(templateData: unknown, format: string | undefined): ValidationResult {
    const { success, errors } = validateEachFormat(templateData, format, (resolved) => this.validateParsed(resolved));

    const data = templateData as TemplateDescriptor;

    return success ? { success, data } : { success, data, errors };
  }

  private validateParsed(templateData: unknown): ValidationResult {
    try {
      let result;

      try {
        result = TemplateDescriptorSchema.safeParse(templateData);
      } catch (zodError) {
        return {
          success: false,
          errors: [
            {
              path: 'zod_parse',
              message: zodError instanceof Error ? zodError.message : 'Zod parsing error',
              code: 'zod_error',
            },
          ],
        };
      }

      // Unknown keys are reported even when the parse succeeded: a strip object drops them silently.
      const schemaErrors = this.schemaErrors(TemplateDescriptorSchema, templateData, result.error, true);

      // The descriptor rules read typed data, so they only run once the schema parse succeeded.
      if (!result.success) {
        return { success: false, errors: schemaErrors };
      }

      const template = result.data;

      try {
        // Only validate section references as hard errors
        // Variable references are warnings since templates often use runtime variables
        const allErrors = [...schemaErrors, ...this.collectDescriptorErrors(template)];

        if (allErrors.length > 0) {
          return {
            success: false,
            data: template,
            errors: allErrors,
          };
        }

        return {
          success: true,
          data: template,
        };
      } catch (error) {
        return {
          success: false,
          errors: [
            {
              path: 'custom_validation',
              message: error instanceof Error ? error.message : 'Error in custom validation',
              code: 'custom_validation_error',
            },
          ],
        };
      }
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            path: 'root',
            message: error instanceof Error ? error.message : 'Unknown validation error',
            code: 'validation_error',
          },
        ],
      };
    }
  }

  // Runs every descriptor-level rule (beyond the zod schema itself) and merges their errors. Extracted
  // out of validateParsed to keep that function under the statement-count lint budget. The rules see the
  // theme-resolved descriptor (what the engine lowers), so `$font.display` is checked as the font it names,
  // with section lengths in beats already in seconds.
  private collectDescriptorErrors(template: TemplateDescriptor): ValidationError[] {
    const lowered = resolveThemeDescriptor(resolveSectionDurations(template).descriptor);

    return [
      ...this.validateSectionReferences(template),
      ...validateBeatsAnalysis(template, this.options.beatsAnalysis ?? true),
      ...validateDescriptorRules(lowered),
    ];
  }

  validateSection(sectionData: unknown): ValidationResult {
    try {
      const result = SectionSchema.safeParse(sectionData);
      const errors = this.schemaErrors(SectionSchema, sectionData, result.error);

      if (!result.success || errors.length > 0) {
        return { success: false, errors };
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            path: 'root',
            message: error instanceof Error ? error.message : 'Unknown validation error',
            code: 'validation_error',
          },
        ],
      };
    }
  }

  async validateTemplateFromFile(filePath: string): Promise<ValidationResult> {
    if (process.env.PLATFORM === 'browser') {
      return {
        success: false,
        errors: [
          {
            path: 'file',
            message: 'File system operations are only supported in Node.js environment',
            code: 'unsupported_environment',
          },
        ],
      };
    }

    try {
      const fs = await import('node:fs');
      const templateContent = fs.readFileSync(filePath, 'utf-8');
      const templateData = JSON.parse(templateContent);

      return this.validateTemplate(templateData);
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            path: 'file',
            message: error instanceof Error ? error.message : 'Failed to read or parse template file',
            code: 'file_error',
          },
        ],
      };
    }
  }

  validateTemplateFromJSON(jsonString: string): ValidationResult {
    try {
      const templateData = JSON.parse(jsonString);

      return this.validateTemplate(templateData);
    } catch {
      return {
        success: false,
        errors: [
          {
            path: 'json',
            message: 'Invalid JSON format',
            code: 'json_parse_error',
          },
        ],
      };
    }
  }

  getValidationSummary(result: ValidationResult): string {
    if (result.success) {
      return 'Template validation passed';
    }

    const errorCount = result.errors?.length ?? 0;
    const errorSummary = result.errors
      ?.slice(0, 3)
      .map((err) => `${err.path}: ${err.message}`)
      .join('; ');

    return `Template validation failed with ${errorCount} error(s): ${errorSummary}${errorCount > 3 ? '...' : ''}`;
  }
}
