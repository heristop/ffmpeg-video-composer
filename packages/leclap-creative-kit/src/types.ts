export type { Orientation as TemplateOrientation } from 'ffmpeg-video-composer/src/schemas/global.schemas.ts';

export type TemplateVariables = Record<string, string | string[]>;

export interface TemplateGlobal {
  orientation?: string;
  variables?: TemplateVariables;
  musicEnabled?: boolean;
  [key: string]: unknown;
}

export interface TemplateSectionOptions {
  useVideoSection?: string;
  fields?: Array<{ name: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface TemplateRenderableSection {
  name: string;
  type: string;
  options?: TemplateSectionOptions;
  filters?: unknown[];
  [key: string]: unknown;
}

export interface TemplatePartialRefSection {
  type: 'partial';
  name?: string;
  ref?: string;
  prefix?: string;
  variables?: Record<string, string>;
  sections?: TemplateSection[];
  [key: string]: unknown;
}

export type TemplateSection = TemplateRenderableSection | TemplatePartialRefSection;

export interface TemplateDescriptor {
  meta?: TemplateMeta;
  global?: TemplateGlobal;
  sections?: TemplateSection[];
  [key: string]: unknown;
}

/**
 * A reusable section fragment referenced from a template via `{ "type": "partial", "ref": "<id>" }`.
 * Lives here (not in partials.ts) so the generated registry can import the type without creating a
 * cycle back into the module that consumes the registry.
 */
export interface TemplatePartial {
  /** Stable id referenced by `{ type: "partial", ref }` (the partial's filename). */
  id: string;
  description: string;
  /**
   * Default values for the partial's own `{{ key }}` placeholders (e.g. its colours). A ref's
   * `variables` override these per use; keys left unset fall back to the default, so the partial
   * keeps its built-in look without every template having to restate it.
   */
  variables?: Record<string, string>;
  /** The real sections this partial expands into. */
  sections: TemplateSection[];
}

export type AppTemplateCategory = 'advanced' | 'portrait';
export type TemplateComplexity = 'simple' | 'intermediate' | 'advanced';

export interface TemplateMeta {
  name?: string;
  description?: string;
  creativeDirection?: string;
}

export type { CaptureMode } from 'ffmpeg-video-composer/src/schemas/section.schemas.ts';
