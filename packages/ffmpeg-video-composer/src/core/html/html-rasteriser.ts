// The contract between the asset stage and whatever draws HTML layers on a platform. Node registers the
// in-process Satori + resvg rasteriser (services/html-node), the browser the same pipeline fed over fetch
// (platform/html), the phone one that posts each layer to a hidden WebView page (raster-messages.ts,
// html-raster-webview.ts). A host without one cannot render a template with an HTML layer: validation
// reports html_unavailable there before any section is encoded.

import type { LayerElement } from './html-element';

/** The container token a host registers its rasteriser under. */
export const HTML_RASTERISER = 'htmlRasteriser';

export interface RasterFont {
  /** The CSS family the layer's styles name (a registry family, or a template's `global.fonts` family). */
  family: string;
  /** The registry `.ttf` file, or a template face's `template-<hash>.ttf` (identity for caching). */
  file: string;
  data: Uint8Array;
  /** Weights text may use: a variable face is instanced at each, a static face is used as it is. */
  weights: number[];
  /** A template face's declared weight: registered under it (a variable face is pinned to it) instead of its own. */
  weight?: number;
  /** A template face's declared style (default normal). */
  style?: 'normal' | 'italic';
}

export interface HtmlRasterRequest {
  element: LayerElement;
  /** The box in output pixels. */
  width: number;
  height: number;
  /** Pixels drawn per output pixel. */
  density: number;
  fonts: RasterFont[];
}

export interface HtmlRaster {
  /** Transparent PNG of `width × density` by `height × density` pixels. */
  png: Uint8Array;
  /** The content's natural height in output pixels, laid out at the box width (overflow when > height). */
  contentHeight: number;
}

export interface HtmlRasteriser {
  /** Names the layout and raster engines, part of every layer's cache key. */
  readonly version: string;
  render(request: HtmlRasterRequest): Promise<HtmlRaster>;
}
