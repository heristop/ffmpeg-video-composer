import type { TemplateDescriptor, Translation, FramingGuide } from '../schemas/template.schemas';
import type { FontRef } from '../core/fonts';

export const SAMPLE_CATEGORIES = ['templates', 'typography', 'app-demos', 'overlays', 'evidence', 'effects'] as const;
export const SAMPLE_BACKENDS = ['native', 'remotion'] as const;
export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number];
export type SampleBackend = (typeof SAMPLE_BACKENDS)[number];

export interface SampleFilters {
  category?: SampleCategory;
  backend?: SampleBackend;
  /** Case-insensitive substring search over ID, title, description and creative direction. */
  query?: string;
}

export interface SampleProjectVideo {
  name: string;
  duration?: number;
  title?: Translation;
  description?: Translation;
  captureMode?: 'front' | 'back' | 'screen' | 'upload';
  allowedCaptureModes?: Array<'front' | 'back' | 'screen' | 'upload'>;
  framingGuide?: FramingGuide;
  forceAspectRatio?: boolean;
  forceOriginalAspectRatio?: boolean;
  speed?: number;
  muteSection?: boolean;
}

export interface SampleFormField {
  section: string;
  name: string;
  label: Translation;
  maxLength?: number;
  default?: string | string[];
}

export interface SampleVariable {
  name: string;
  default?: string | string[];
  /** Literal authored tokens; an empty array means the default is not referenced in rendered sections. */
  placeholders: string[];
  source: 'global' | 'form' | 'runtime' | 'placeholder';
}

export interface SampleAsset {
  kind: 'video' | 'image' | 'animation' | 'font' | 'music' | 'effect-asset' | 'asset';
  /** Authored reference without rewriting, or an engine-resolved font filename when source=preset. */
  reference: string;
  /** Descriptor location after partial expansion, including a virtual filter path for resolved presets. */
  path: string;
  default?: string | string[];
  /** Marks effective font requirements derived from pure text presets, including their overrides. */
  source?: 'preset';
  /** Family metadata retained when the effective file comes from an object font reference. */
  font?: FontRef;
}

export interface SampleEffect {
  id: string;
  version: string;
  sections: string[];
  /** True when the effect is absent from the built-in MCP catalog and needs operator registration. */
  customCatalog: boolean;
}

export interface SampleRequirements {
  projectVideos: SampleProjectVideo[];
  formFields: SampleFormField[];
  variables: SampleVariable[];
  assets: SampleAsset[];
  effects: SampleEffect[];
  setup: string[];
}

export interface SampleSummary {
  id: string;
  title: string;
  description: string;
  category: SampleCategory;
  /** Canonical descriptor source in the authoring repository; not a local installed file. */
  source: string;
  section?: string;
  orientation: 'landscape' | 'portrait' | 'square';
  backend: SampleBackend;
  creativeDirection?: string;
  /** Relative website paths; previews/media are not included in the package. */
  showcasePath: string;
  preview: { video: string; poster: string; template: string };
  requirements: SampleRequirements;
}

export interface SampleDetail extends SampleSummary {
  /** Self-contained descriptor with referenced partials embedded, but no bundled media. */
  template: TemplateDescriptor;
}
