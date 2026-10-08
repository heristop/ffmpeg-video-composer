// One HTML layer drawn outside a render, for the builder's live preview: the same theme tokens, placeholders,
// subset, fonts, density and rasteriser as the asset stage, so the preview is the frame's layer, byte for
// byte, along with every advisory the render would log.

import { defaultHtmlFamily } from '@/core/html/html-fonts';
import { HTML_LAYER_DENSITY, inlineImages } from '@/core/html/html-layer';
import type { HtmlRasteriser, RasterFont } from '@/core/html/html-rasteriser';
import { resolveThemeDescriptor } from '@/core/theme/resolve';
import { overflowFinding, prepareWithFindings, type HtmlLayerFinding } from './html-layer-findings';

export interface HtmlLayerPreviewRequest {
  html: string;
  css?: string;
  /** The box in output pixels. */
  width: number;
  height: number;
  /** The descriptor's `global`: its theme resolves `$color.*` / `$font.*` and names the default family. */
  global?: unknown;
  /** Values of the `{{ placeholders }}` (variables, sample field values); the others are reported. */
  values?: Readonly<Record<string, string>>;
  /** The bytes of a registry font file. */
  loadFont: (file: string) => Promise<Uint8Array>;
  /** A template image (`<img src>`, CSS `url()`) as a `data:` URI, or null when it cannot be read. */
  readImage?: (ref: string) => Promise<string | null>;
}

export interface HtmlLayerPreview {
  /** Transparent PNG of `width × height` pixels (the box at the render's density). */
  png: Uint8Array;
  width: number;
  height: number;
  findings: HtmlLayerFinding[];
}

type Bag = Record<string, unknown>;

// Theme tokens resolve over a whole descriptor: the layer rides in a one-section stand-in.
function themed(request: HtmlLayerPreviewRequest): { html: string; css: string; global: unknown } {
  const descriptor = resolveThemeDescriptor({
    global: request.global,
    sections: [{ inputs: [{ type: 'html', html: request.html, css: request.css ?? '' }] }],
  });
  const input = ((descriptor.sections as Bag[])[0].inputs as Bag[])[0];

  return { html: String(input.html), css: String(input.css), global: descriptor.global };
}

async function imageMap(refs: string[], request: HtmlLayerPreviewRequest): Promise<Map<string, string>> {
  const read = await Promise.all(
    refs.map(async (ref) => [ref, ref.startsWith('data:') ? ref : ((await request.readImage?.(ref)) ?? null)] as const)
  );

  return new Map(read.filter((entry): entry is readonly [string, string] => entry[1] !== null));
}

function valueLookup(values: Readonly<Record<string, string>>): (name: string) => string | undefined {
  return (name) => (Object.hasOwn(values, name) ? values[name] : undefined);
}

export async function previewHtmlLayer(
  request: HtmlLayerPreviewRequest,
  rasteriser: HtmlRasteriser
): Promise<HtmlLayerPreview> {
  const { html, css, global } = themed(request);
  const { prepared, findings } = prepareWithFindings(
    { html, css, width: request.width, height: request.height },
    valueLookup(request.values ?? {}),
    defaultHtmlFamily(global)
  );
  const element = inlineImages(prepared.element, await imageMap(prepared.imageRefs, request));
  const fonts: RasterFont[] = await Promise.all(
    prepared.faces.map(async (face) => ({ ...face, data: await request.loadFont(face.file) }))
  );
  const raster = await rasteriser.render({
    element,
    width: request.width,
    height: request.height,
    density: HTML_LAYER_DENSITY,
    fonts,
  });

  return {
    png: raster.png,
    width: request.width * HTML_LAYER_DENSITY,
    height: request.height * HTML_LAYER_DENSITY,
    findings: [...findings, ...overflowFinding(raster.contentHeight, request.height)],
  };
}
