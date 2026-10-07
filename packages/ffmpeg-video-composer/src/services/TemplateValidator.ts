import type { TemplateDescriptor } from '../schemas/template.schemas';
import { referenceFinding } from './validation/reference-finding';
import { BaseTemplateValidator, type ValidationError } from './BaseTemplateValidator';
import { accentAdvisories, findAccentOveruse } from '@/core/theme/accent';
import { findPaletteDrift, paletteAdvisories } from '@/core/theme/palette';
import type { GeometryWarning, FontLoader } from './geometry';
import { collectMotionWarnings, type MotionWarning } from './motion-lint';
import { capabilityFindings } from './capability-validation';
import type { CapabilityReport } from '@/core/capabilities';
import { collectScriptWarnings, type ScriptLintCapabilities } from './script-lint';
import { emojiAdvisories } from './emoji-advisories';
import { subtitleAdvisories } from './subtitles-advisories';
import { footageAdvisories } from './footage-advisories';
import { beatGridAdvisories } from './beats-advisory';
import { nondeterminismAdvisories } from './determinism-advisories';
import { adviseEachFormat, adviseEachFormatSync, expandedForFormats } from './validation/format-validation';
import { formatAdvisories } from '@/core/formats/advisories';
import { takeAdvisories } from './take-validation';
import { soundAdvisories } from './sound-advisories';
import { expandPartialsSafe } from '@/core/partials';
import { declaresFields, fieldAdvisories, withFieldDefaults } from './field-advisories';

export type { ValidationError, ValidationResult } from './BaseTemplateValidator';
export type { MotionWarning } from './motion-lint';
export type { ScriptLintCapabilities } from './script-lint';
export type { GeometryWarning, FontLoader } from './geometry';

// Footage advisories read the expanded sections, like the pacing lint, so paths index them.
function takeWarnings(template: unknown): MotionWarning[] {
  const expanded = expandPartialsSafe(template);

  return expanded.ok && expanded.data ? takeAdvisories(expanded.data) : [];
}

// Expansion advisories (partial_compressed: a ref squeezed under its partial's fixed intro/outro). Partials
// expand before formats resolve, so these are the same for every format: reported once, at authored paths.
function partialWarnings(template: unknown): MotionWarning[] {
  const expanded = expandPartialsSafe(template);

  return expanded.ok ? (expanded.warnings ?? []).map((w) => ({ ...w, severity: 'warn' as const })) : [];
}

// The field contract's advisories, once on the authored template (they name authored paths).
function fieldWarnings(template: unknown): MotionWarning[] {
  return fieldAdvisories(template).map((w) => ({ ...w, severity: 'warn' as const }));
}

// The full validator: everything BaseTemplateValidator checks, plus the advisory passes. Advisories
// never enter `errors` nor flip `success` — a template that renders badly still renders.
export class TemplateValidator extends BaseTemplateValidator {
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
            errors.push(
              referenceFinding(path, `Undefined variable reference: ${variable}`, 'undefined_variable', {
                name: variable,
                known: [...definedVariables],
                fix: `define "${variable}" in global.variables`,
              })
            );
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

  // A template that declares `global.fields` gets field_undefined (getFieldWarnings) instead, which also
  // knows the fields, form fields and partial variables.
  getVariableWarnings(template: TemplateDescriptor): ValidationError[] {
    return declaresFields(template) ? [] : this.validateVariableReferences(template);
  }

  // Advisory: the typed field contract (services/field-advisories.ts) — field_undefined, field_unused,
  // field_type_mismatch, field_missing_required. `values` are the inputs a render would pass.
  getFieldWarnings(template: TemplateDescriptor, values?: Readonly<Record<string, unknown>>): ValidationError[] {
    return fieldAdvisories(template, values);
  }

  // Advisory: sections that spread the theme accent over too many elements (core/theme/accent.ts),
  // and colours/fonts that drift off the theme (core/theme/palette.ts).
  getThemeWarnings(template: TemplateDescriptor): ValidationError[] {
    return [...findAccentOveruse(template), ...findPaletteDrift(template)];
  }

  // Advisory, exactly like getVariableWarnings: geometry findings never enter `errors` and never
  // flip `success`. A template that renders badly still renders, so this is guidance, not a gate.
  // Lazily loaded: the geometry graph (font metrics, colour-contrast math, caption layout) is only
  // ever called from Node consumers, and a static import on a class method can't be tree-shaken out
  // of the browser and React Native chunks. `collectGeometryWarnings` expands partials itself, so a
  // caller that skipped `validateTemplate` still gets the partial's sections measured.
  async getGeometryWarnings(template: TemplateDescriptor, loadFont?: FontLoader): Promise<GeometryWarning[]> {
    const { collectGeometryWarnings } = await import('./geometry');

    // Per format when the template declares several (each its own frame, platform and safe zones).
    return adviseEachFormat(withFieldDefaults(template), (resolved) =>
      collectGeometryWarnings(resolved as TemplateDescriptor, loadFont)
    );
  }

  // Advisory, like getGeometryWarnings: pacing findings read off the motion timeline (ease monotony,
  // front-loaded sections, dead air, flat tempo…) plus assertions that can't be measured render-free.
  // Synchronous and render-free; partials are expanded first, so paths index the expanded sections.
  // The theme advisories (one accent per idea, palette drift), the emoji advisories (missing bundled image,
  // per-section cap, strip mode), the subtitle advisories (split, shrunk, past the end), the footage
  // advisories (extreme ramp speeds, ignored focus, blur fit under overlays, a clip range shorter than the
  // section), the low-confidence beat grid advisory and the take advisories (take-validation.ts) ride along, so every surface
  // that shows pacing feedback shows them. Per format when the template declares several, plus the
  // whole-template format advisories (format_crop_only, format_story_diverges: core/formats/advisories.ts).
  // Script/mask advisories ride along too (services/script-lint.ts); pass the target build's
  // capabilities to also hear what it can't draw (rtl_unshaped, mask_unavailable).
  getMotionWarnings(authored: unknown, capabilities?: ScriptLintCapabilities): MotionWarning[] {
    const template = withFieldDefaults(authored);
    const perFormat = adviseEachFormatSync(template, (resolved) => [
      ...collectMotionWarnings(resolved),
      ...accentAdvisories(resolved),
      ...paletteAdvisories(resolved),
      ...emojiAdvisories(resolved),
      ...subtitleAdvisories(resolved),
      ...footageAdvisories(resolved),
      ...beatGridAdvisories(resolved),
      ...nondeterminismAdvisories(resolved),
      ...takeWarnings(resolved),
      ...soundAdvisories(resolved),
      ...collectScriptWarnings(resolved, capabilities),
    ]);

    return [
      ...fieldWarnings(authored),
      ...partialWarnings(template),
      ...perFormat,
      ...formatAdvisories(expandedForFormats(template)),
    ];
  }

  // Advisory: `feature_unavailable` for every feature the template uses that the probed FFmpeg cannot
  // render (drawtext, xfade, lut3d, loudnorm…). Pure; without a capability report there is nothing to
  // compare against, so it returns nothing. Node hosts pass `probeCapabilities()`.
  getCapabilityWarnings(template: unknown, capabilities?: CapabilityReport | null): ValidationError[] {
    return capabilities ? capabilityFindings(template, capabilities) : [];
  }
}
