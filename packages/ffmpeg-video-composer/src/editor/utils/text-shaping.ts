// drawtext and complex scripts. HarfBuzz (every drawtext build since FFmpeg 6.1) joins Arabic letters
// and orders Indic clusters, but only libfribidi reorders a mixed right-to-left line; FFmpeg exposes it
// as the `text_shaping` option, which exists ONLY in builds linking libfribidi. So the option is set
// for copy that needs it when the build has it, and an `rtl_unshaped` warning is raised otherwise.

import type { Filter } from '@/core/types';
import { hasRtl, needsShaping, textValues } from '@/core/text-scripts';
import type { EngineCapabilities } from './filter-compat';

export const RTL_UNSHAPED_WARNING =
  '[rtl_unshaped] right-to-left text drawn by an FFmpeg build without libfribidi: letters join, but a ' +
  'line mixing directions may read out of order';

/**
 * The drawtext with `text_shaping=1` when its copy needs shaping and the build supports it; `warn` is
 * called (and the filter left as is) for right-to-left copy the build can't reorder.
 */
export function withTextShaping(filter: Filter, caps: EngineCapabilities, warn: (message: string) => void): Filter {
  if (filter.type !== 'drawtext' || !filter.values) return filter;

  const texts = textValues(filter.values.text);

  if (!texts.some(needsShaping)) return filter;

  if (caps.textShaping) return { ...filter, values: { ...filter.values, text_shaping: 1 } as Filter['values'] };

  if (texts.some(hasRtl)) warn(RTL_UNSHAPED_WARNING);

  return filter;
}
