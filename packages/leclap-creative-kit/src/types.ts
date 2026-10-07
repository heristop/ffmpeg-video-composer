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
  /** Total seconds for this use; only the hold of the partial envelope stretches. */
  duration?: number;
  /** Snap a partial sync point onto a beat/cue by resizing the section before the ref. */
  align?: { sync: string; to: number | string };
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
  /** Fixed intro/outro seconds of the partial motion: only the hold between them stretches on a ref `duration`. */
  envelope?: { in: number; out: number };
  /** Named moments (seconds from the partial start, inside the IN envelope), exported as `cue:<id>`. */
  syncPoints?: Array<{ id: string; offset: number }>;
  /** Rhetorical jobs the partial does (reveal, emphasize, prove, bridge, orient, ask…). */
  jobs?: string[];
  useWhen?: string;
  avoidWhen?: string;
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
