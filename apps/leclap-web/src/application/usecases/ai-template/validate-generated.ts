// Validates a generated descriptor with the engine's own TemplateValidator, then with the builder's
// extra constraints (it cannot edit registered-effect or partial sections). Issues keep every field
// the validator offers — including `hint` / `suggestion` when present — because they are fed back to
// the model verbatim in the repair loop.
import { TemplateValidator } from 'ffmpeg-video-composer/src/services/TemplateValidator.ts';
import type { TemplateDescriptor } from '@leclap/creative-kit/editor';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
  hint?: string;
  suggestion?: string;
}

export type GeneratedValidation =
  | { ok: true; descriptor: TemplateDescriptor }
  | { ok: false; issues: ValidationIssue[] };

const validator = new TemplateValidator();

function optionalText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  return typeof value === 'string' && value !== '' ? value : undefined;
}

// Copy an engine error into an issue, keeping optional guidance fields the engine may add.
function toIssue(error: { path: string; code: string; message: string }): ValidationIssue {
  const record = error as unknown as Record<string, unknown>;
  const hint = optionalText(record, 'hint');
  const suggestion = optionalText(record, 'suggestion');

  return {
    path: error.path,
    code: error.code,
    message: error.message,
    ...(hint ? { hint } : {}),
    ...(suggestion ? { suggestion } : {}),
  };
}

function builderIssues(value: Record<string, unknown>): ValidationIssue[] {
  const sections = Array.isArray(value.sections) ? (value.sections as Array<{ type?: unknown }>) : [];
  const issues: ValidationIssue[] = [];

  if (sections.length === 0) {
    issues.push({ path: 'sections', code: 'empty_template', message: 'The template needs at least one section.' });
  }

  for (const [index, section] of sections.entries()) {
    if (section.type === 'effect' || section.type === 'partial') {
      issues.push({
        path: `sections.${String(index)}.type`,
        code: 'builder_unsupported_section',
        message: `Section type "${section.type}" cannot be edited in the builder.`,
        hint: 'Rebuild it as a color_background section with drawtext or kinetic text, or as a project_video section.',
      });
    }
  }

  return issues;
}

export function validateGenerated(value: Record<string, unknown>): GeneratedValidation {
  const structural = builderIssues(value);
  const result = validator.validateTemplate(value);

  if (!result.success) {
    return { ok: false, issues: [...structural, ...(result.errors ?? []).map(toIssue)] };
  }

  if (structural.length > 0) return { ok: false, issues: structural };

  return { ok: true, descriptor: result.data as TemplateDescriptor };
}

// An advisory from the engine's pacing / theme lint (getMotionWarnings): never blocks a template.
export interface Advisory extends ValidationIssue {
  severity: 'warn' | 'info';
}

// The engine's render-free advisories for a valid descriptor (ease monotony, front-loading, flat
// tempo, accent overuse, palette drift…), with their hints.
export function motionAdvisories(descriptor: TemplateDescriptor): Advisory[] {
  return validator
    .getMotionWarnings(descriptor)
    .map((warning) => ({ ...toIssue(warning), severity: warning.severity }));
}

export function formatIssues(issues: ValidationIssue[], limit = 25): string {
  const lines = issues.slice(0, limit).map((issue) => {
    const guidance = [issue.hint, issue.suggestion].filter(Boolean).join(' ');

    return `- ${issue.path || 'root'} [${issue.code}]: ${issue.message}${guidance ? ` (hint: ${guidance})` : ''}`;
  });
  const more = issues.length > limit ? `\n- …and ${String(issues.length - limit)} more` : '';

  return `${lines.join('\n')}${more}`;
}
