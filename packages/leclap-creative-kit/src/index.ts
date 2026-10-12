// Shared app template discovery. The generated registry imports every JSON in src/templates/, so
// adding a template is just adding a descriptor file with optional human-facing `meta` fields.
import type { AppTemplateCategory, TemplateComplexity, TemplateDescriptor, TemplateOrientation } from './types';
import { TEMPLATE_DESCRIPTORS } from './templates.generated';
import { descriptorInFormat, formatsOf, resolveTemplateRef } from './template-formats';

export interface AppTemplate {
  /** Stable catalog id (hyphenated), shared by web + expo. */
  id: string;
  name: string;
  description: string;
  category: AppTemplateCategory;
  complexity: TemplateComplexity;
  orientation: TemplateOrientation;
  /** Every format the template renders: its own orientation and each one its `formats` composes. */
  formats: TemplateOrientation[];
  /** True when the descriptor has a `form` section (the app collects fields before compiling). */
  hasForm: boolean;
  descriptor: TemplateDescriptor;
}

function titleCase(id: string): string {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function orientationOf(d: TemplateDescriptor): TemplateOrientation {
  if (d.global?.orientation === 'portrait') return 'portrait';

  if (d.global?.orientation === 'square') return 'square';

  return 'landscape';
}

function hasFormOf(d: TemplateDescriptor): boolean {
  return (d.sections ?? []).some((s) => s.type === 'form');
}

function categoryOf(descriptor: TemplateDescriptor): AppTemplateCategory {
  return orientationOf(descriptor) === 'portrait' ? 'portrait' : 'advanced';
}

function complexityOf(descriptor: TemplateDescriptor): TemplateComplexity {
  const count = descriptor.sections?.length ?? 0;

  if (count <= 3) return 'simple';

  if (count <= 6) return 'intermediate';

  return 'advanced';
}

const complexityOrder: Record<TemplateComplexity, number> = { simple: 0, intermediate: 1, advanced: 2 };

function define(id: string, raw: unknown): AppTemplate {
  const descriptor = raw as TemplateDescriptor;
  const meta = descriptor.meta ?? {};

  return {
    id,
    name: meta.name ?? titleCase(id),
    description: meta.description ?? 'LeClap template.',
    category: categoryOf(descriptor),
    complexity: complexityOf(descriptor),
    orientation: orientationOf(descriptor),
    formats: formatsOf(descriptor),
    hasForm: hasFormOf(descriptor),
    descriptor,
  };
}

export const APP_TEMPLATES: AppTemplate[] = Object.entries(TEMPLATE_DESCRIPTORS)
  .map(([id, descriptor]) => define(id, descriptor))
  .sort((a, b) => complexityOrder[a.complexity] - complexityOrder[b.complexity] || a.name.localeCompare(b.name));

export const APP_TEMPLATES_BY_ID: Record<string, AppTemplate | undefined> = Object.fromEntries(
  APP_TEMPLATES.map((t) => [t.id, t])
);

/** The template composed for `format` (see template-formats.ts); itself for its own or an undeclared format. */
export function appTemplateInFormat(template: AppTemplate, format: TemplateOrientation): AppTemplate {
  const descriptor = descriptorInFormat(template.descriptor, format);

  if (descriptor === template.descriptor) return template;

  return { ...template, descriptor, orientation: format, category: categoryOf(descriptor) };
}

/**
 * The catalog template a stored id refers to, in `format` when given, else in the format a retired id
 * implies (`present-yourself-portrait` opens Present Yourself in portrait).
 */
export function findAppTemplate(ref: string, format?: TemplateOrientation): AppTemplate | undefined {
  const resolved = resolveTemplateRef(ref);
  const template = APP_TEMPLATES_BY_ID[resolved.id];
  const wanted = format ?? resolved.format;

  if (!template || !wanted) return template;

  return appTemplateInFormat(template, wanted);
}

export { descriptorInFormat, formatsOf, resolveTemplateRef, type TemplateRef } from './template-formats';

export type {
  AppTemplateCategory,
  CaptureMode,
  TemplateComplexity,
  TemplateDescriptor,
  TemplateOrientation,
} from './types';
