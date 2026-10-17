// The compositing services sugar lowerings get from their segment (SugarContext.masks): mask
// availability on the active build, extra-input registration and safe colour resolution.

import type { ProjectConfig } from '@/core/types';
import { engineCapabilities, hasFilter, type EngineFeatures } from '../utils/filter-compat';
import { ExtraInputs } from '../utils/extra-inputs';
import type { MaskSugarContext } from './sugar-context';
import { lowerFx } from './fx';
import { lowerShape } from './shape-draw';
import { lowerStroke } from './stroke-graphics';
import { htmlCaptionFilters } from './subtitles-html';

export { HTML_RASTERISER } from '@/core/html/html-rasteriser';

/** A fresh per-segment registry of extra inputs. */
export function createExtraInputs(): ExtraInputs {
  return new ExtraInputs();
}

export interface CompositingOptions {
  config: ProjectConfig;
  features: EngineFeatures | null;
  extras: ExtraInputs;
  /** The segment's colour resolution (variables, colour lists). */
  formatColor: (color: string) => string;
  warn: (message: string) => void;
  /** Whether the host registered an HTML rasteriser (HTML captions fall back to drawbox without one). */
  htmlLayers?: boolean;
}

// A resolved colour reduced to characters that are inert inside a filter option.
function safeColor(color: string): string {
  return color.replace(/[^#A-Za-z0-9@._]/g, '') || 'white';
}

export function compositingContext(options: CompositingOptions): MaskSugarContext {
  const caps = engineCapabilities(options.config, options.features);

  return {
    available: hasFilter(caps, 'alphamerge'),
    input: options.extras.register,
    color: (color) => safeColor(options.formatColor(color)),
    warn: options.warn,
    has: (filter) => hasFilter(caps, filter),
    htmlLayers: options.htmlLayers,
    effects: lowerFx,
    strokes: lowerStroke,
    captions: htmlCaptionFilters,
    shapes: lowerShape,
  };
}
