// Subtitles drawn through the HTML layers (`subtitles.renderer: "html"`): the same plan as the drawbox
// lowering, sampled into the distinct looks of its cues (core/captions/caption-frames.ts). The asset stage
// rasterises each look once and plays them as one timed image stream (editor/html/stage-caption-track.ts),
// so the whole track costs one extra input and one overlay, however long the transcript. Only `scale` and
// `overlay` run on that stream: both on the on-device allowlist.
//
// Without a segment to take the extra input (validation lowers sugar without one) or without an HTML
// rasteriser on the host, the caller draws the drawbox renderer instead.

import type { Filter } from '@/core/types';
import { captionSlides } from '@/core/captions/caption-frames';
import { captionBand, captionLook } from '@/core/captions/caption-html';
import type { HtmlCaptionRequest } from './sugar-context';

/** The extra input a section's caption track is registered under. */
export const CAPTION_TRACK_KEY = 'subtitles';

const UNAVAILABLE =
  '[caption_html_unavailable] subtitles.renderer "html" needs an HTML rasteriser, which this host has not ' +
  'registered: the captions are drawn with the drawbox renderer';

/** The filters compositing the caption track, or null when the drawbox renderer must draw it instead. */
export function htmlCaptionFilters({ plan, palette, effect, ctx, explicit }: HtmlCaptionRequest): Filter[] | null {
  const masks = ctx.masks;

  if (!masks) return null;

  if (masks.htmlLayers === false) {
    if (explicit) masks.warn(UNAVAILABLE);

    return null;
  }

  const [width, height] = ctx.scale.split(':').map(Number);
  const slides = captionSlides(plan, ctx.fps);

  if (slides.length === 0) return [];

  const look = captionLook(plan.style, palette, effect);
  const band = captionBand(plan, { width, height }, look);
  const track = { plan: { cues: plan.cues, style: plan.style }, look, band, fps: ctx.fps, slides };
  const label = masks.input(CAPTION_TRACK_KEY, { captions: track });

  if (label === null) return null;

  // The rasters are drawn at HTML_LAYER_DENSITY (2×), like every HTML layer, and scaled back into the band.
  return [
    {
      type: 'graph',
      graph: [
        { filters: [{ type: 'null' }], outputs: ['subs_base'] },
        {
          inputs: [label],
          filters: [{ type: 'scale', value: `${band.width}:${band.height}` }],
          outputs: ['subs_track'],
        },
        { inputs: ['subs_base', 'subs_track'], filters: [{ type: 'overlay', value: `${band.x}:${band.y}` }] },
      ],
    },
  ];
}
