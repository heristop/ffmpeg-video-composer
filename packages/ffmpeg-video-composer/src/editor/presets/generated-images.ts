// Images the engine generates at compile time instead of fetching: a `panel:` URL (rounded caption
// panel, rounded-panel.ts), a `sprite:` URL (fx sprite, fx-sprites.ts) or a `trace:` URL (a path graphic's
// stroke or arc-length mask, path-raster.ts). The asset stage writes the
// bytes to the build FS under `name`, so the same URL is a cache hit on every platform.

import { parsePanelUrl, panelFileName, roundedPanelPng } from './rounded-panel';
import { parseSpriteUrl, spriteFileName, spritePng } from './fx-sprites';
import { parseTraceUrl, traceFileName, tracePng } from './path-raster';

export interface GeneratedImage {
  /** Deterministic file name, unique per spec. */
  name: string;
  /** Log label. */
  label: 'Panel' | 'Sprite' | 'Trace';
  produce: () => Uint8Array;
}

/** The generated image a URL describes, or null for an ordinary (fetchable) URL. */
export function generatedImage(url: string): GeneratedImage | null {
  const panel = parsePanelUrl(url);

  if (panel) return { name: panelFileName(panel), label: 'Panel', produce: () => roundedPanelPng(panel) };

  const trace = parseTraceUrl(url);

  if (trace) return { name: traceFileName(trace), label: 'Trace', produce: () => tracePng(trace) };

  const sprite = parseSpriteUrl(url);

  return sprite ? { name: spriteFileName(sprite), label: 'Sprite', produce: () => spritePng(sprite) } : null;
}
