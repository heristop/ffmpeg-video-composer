import type { z } from 'zod';
import {
  TemplateDescriptorSchema,
  SectionSchema,
  type TemplateDescriptor,
  type Section,
} from '../schemas/template.schemas';
import {
  validateTransitions,
  validateMotion,
  validateGlobalAnimations,
  validateGlobalWatermark,
  validateFonts,
  type ValidationError,
} from './template-validation-rules';
import { expandPartialsSafe } from '@/core/partials';
import type { GeometryWarning, FontLoader } from './geometry';

export type { ValidationError } from './template-validation-rules';
export type { GeometryWarning, FontLoader } from './geometry';

export interface ValidationResult {
  success: boolean;
  data?: TemplateDescriptor | Section;
  errors?: ValidationError[];
}

export class TemplateValidator {
  private formatZodError(error: z.ZodError): ValidationError[] {
    try {
      // Handle different ZodError structures
      let errorArray: Array<{ path?: unknown; message?: unknown; code?: unknown }> = [];

      const hasIssues = Array.isArray(error.issues);

      if (!hasIssues && !error.message) {
        return [
          {
            path: 'zod_error_structure',
            message: 'Invalid ZodError structure',
            code: 'invalid_zod_error',
          },
        ];
      }

      if (hasIssues) {
        errorArray = error.issues;
      }

      if (!hasIssues && error.message) {
        // Try to parse the message as JSON (some versions of Zod store errors this way)
        try {
          errorArray = JSON.parse(error.message);
        } catch {
          // If parsing fails, create a single error from the message
          errorArray = [
            {
              path: [],
              message: error.message,
              code: 'zod_error',
            },
          ];
        }
      }

      return errorArray.map((err) => ({
        path: Array.isArray(err.path) ? err.path.join('.') : 'unknown',
        message: typeof err.message === 'string' ? err.message : 'Unknown validation error',
        code: typeof err.code === 'string' ? err.code : 'unknown',
      }));
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

  private validateVariableReferences(template: TemplateDescriptor): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!template.global?.variables) {
      return errors;
    }

    const definedVariables = new Set(Object.keys(template.global.variables));

    const variablePattern = /\{\{\s*(\w+)\s*\}\}/g;

    function checkVariableReferences(obj: unknown, path = ''): void {
      if (typeof obj === 'string') {
        let match;

        while ((match = variablePattern.exec(obj)) !== null) {
          const variable = match[1];

          if (!definedVariables.has(variable)) {
            errors.push({
              path,
              message: `Undefined variable reference: ${variable}`,
              code: 'undefined_variable',
            });
          }
        }

        return;
      }

      if (Array.isArray(obj)) {
        for (let index = 0; index < obj.length; index++) {
          checkVariableReferences(obj[index], `${path}[${index}]`);
        }

        return;
      }

      if (obj && typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
          const newPath = path ? `${path}.${key}` : key;
          checkVariableReferences(value, newPath);
        }
      }
    }

    checkVariableReferences(template, 'template');

    return errors;
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
          errors.push({
            path: `sections[${index}].options.useVideoSection`,
            message: `Referenced section "${referencedSection}" does not exist`,
            code: 'undefined_section_reference',
          });
        }
      }
    }

    return errors;
  }

  validateTemplate(templateData: unknown): ValidationResult {
    // Expand `{ type: "partial", ref }` sections to real sections first, so the schema + reference
    // checks (and the engine downstream) only ever see real sections.
    const expansion = expandPartialsSafe(templateData);

    if (!expansion.ok) {
      return { success: false, errors: [expansion.error] };
    }

    return this.validateParsed(expansion.data);
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

      if (!result.success) {
        return {
          success: false,
          errors: this.formatZodError(result.error),
        };
      }

      const template = result.data;

      try {
        // Only validate section references as hard errors
        // Variable references are warnings since templates often use runtime variables
        const allErrors = this.collectDescriptorErrors(template);

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
  // out of validateParsed to keep that function under the statement-count lint budget.
  private collectDescriptorErrors(template: TemplateDescriptor): ValidationError[] {
    return [
      ...this.validateSectionReferences(template),
      ...validateTransitions(template),
      ...validateMotion(template),
      ...validateGlobalAnimations(template),
      ...validateGlobalWatermark(template),
      ...validateFonts(template),
    ];
  }

  validateSection(sectionData: unknown): ValidationResult {
    try {
      const result = SectionSchema.safeParse(sectionData);

      if (!result.success) {
        return {
          success: false,
          errors: this.formatZodError(result.error),
        };
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

  getVariableWarnings(template: TemplateDescriptor): ValidationError[] {
    return this.validateVariableReferences(template);
  }

  // Advisory, exactly like getVariableWarnings: geometry findings never enter `errors` and never
  // flip `success`. A template that renders badly still renders, so this is guidance, not a gate.
  // Lazily loaded: the geometry graph (font metrics, colour-contrast math, caption layout) is only
  // ever called from Node consumers, and a static import on a class method can't be tree-shaken out
  // of the browser and React Native chunks. `collectGeometryWarnings` expands partials itself, so a
  // caller that skipped `validateTemplate` still gets the partial's sections measured.
  async getGeometryWarnings(template: TemplateDescriptor, loadFont?: FontLoader): Promise<GeometryWarning[]> {
    const { collectGeometryWarnings } = await import('./geometry');

    return collectGeometryWarnings(template, loadFont);
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
