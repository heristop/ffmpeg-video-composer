// The live preview of one HTML layer, redrawn a moment after the author stops typing (debounced) so a
// keystroke never queues a raster. Keeps the last drawing on screen while the next one is on its way.
import { useEffect, useState } from 'react';
import type { HtmlLayerFinding } from 'ffmpeg-video-composer/src/browser.ts';
import type { HtmlLayer } from '../../templateEditorModel';
import type { HtmlPreviewEnv } from './html-layer-env';
import { previewHtmlLayer } from './html-layer-preview';

export const HTML_PREVIEW_DEBOUNCE_MS = 250;

export interface HtmlLayerPreviewState {
  url?: string;
  findings: HtmlLayerFinding[];
  status: 'drawing' | 'ready' | 'failed';
  error?: string;
}

type SetPreview = (update: (previous: HtmlLayerPreviewState) => HtmlLayerPreviewState) => void;

const INITIAL: HtmlLayerPreviewState = { findings: [], status: 'drawing' };

// Draws the layer and reports into `set` unless the preview moved on meanwhile (`live` turned false).
function drawInto(layer: HtmlLayer, env: HtmlPreviewEnv, live: () => boolean, set: SetPreview): void {
  set((previous) => ({ ...previous, status: 'drawing' }));
  previewHtmlLayer(layer, env).then(
    (result) => {
      if (live()) set(() => ({ url: result.url, findings: result.findings, status: 'ready' }));
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);

      if (live()) set((previous) => ({ ...previous, status: 'failed', error: message }));
    }
  );
}

export const useHtmlLayerPreview = (layer: HtmlLayer, env: HtmlPreviewEnv): HtmlLayerPreviewState => {
  const [state, setState] = useState<HtmlLayerPreviewState>(INITIAL);
  const { html, css, width, height } = layer;
  // Only what changes the drawing: moving or naming the layer redraws nothing.
  const envKey = JSON.stringify({ global: env.global, values: env.values });

  useEffect(() => {
    let live = true;
    const drawn = { id: '', html, css, width, height };
    const context = { ...(JSON.parse(envKey) as Omit<HtmlPreviewEnv, 'fields'>), fields: [] };
    const timer = setTimeout(() => {
      drawInto(drawn, context, () => live, setState);
    }, HTML_PREVIEW_DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [html, css, width, height, envKey]);

  return state;
};
