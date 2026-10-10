// An HTML layer from authored HTML/CSS to the element tree a rasteriser draws: placeholders filled
// (HTML-escaped), markup sanitised, the stylesheet folded into inline styles, the flow rebuilt on flexbox,
// fonts mapped onto the registry and images listed for the asset stage to read. Pure and platform-neutral:
// the rasteriser (Satori + resvg, WebAssembly) is supplied by the host (services/html-node on Node).

import { sha256Hex } from '../determinism/sha256';
import { canonicalJson } from '../determinism/hash';
import { parseStylesheet } from './css-parse';
import { cssUrlRefs, type LayerStyle } from './css-properties';
import { escapeHtml } from './html-entities';
import { buildLayerElement, type LayerChild, type LayerElement } from './html-element';
import { layerFonts, type LayerFontFace } from './html-fonts';
import { parseHtml } from './html-parse';
import { sanitiseHtml, type HtmlFinding } from './html-sanitise';
import { styleTree } from './html-styles';
import type { CustomFontFace } from './template-fonts';

import { HTML_LAYER_DENSITY, HTML_LAYOUT_VERSION } from './limits';

export { HTML_LAYER_DENSITY, HTML_LAYER_MAX_SIZE, HTML_LAYOUT_VERSION } from './limits';

export interface HtmlLayerSpec {
  html: string;
  css?: string;
  width: number;
  height: number;
}

export interface PreparedHtmlLayer {
  element: LayerElement;
  faces: LayerFontFace[];
  /** Template asset references of `<img src>` and CSS `url()`, in document order. */
  imageRefs: string[];
  /** Markup and CSS the sanitiser and the subset dropped. */
  findings: HtmlFinding[];
  /** `font-family` names neither the template nor the registry knows (they fall back to the default family). */
  unknownFonts: string[];
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** `{{ name }}` placeholders filled with HTML-escaped values; the names `lookup` has no value for stay. */
export function fillHtmlPlaceholders(
  html: string,
  lookup: (name: string) => string | undefined
): { html: string; missing: string[] } {
  const missing: string[] = [];
  const filled = html.replace(PLACEHOLDER, (match, name: string) => {
    const value = lookup(name);

    if (value !== undefined) return escapeHtml(value);

    if (!missing.includes(name)) missing.push(name);

    return match;
  });

  return { html: filled, missing };
}

function walkElements(element: LayerElement, visit: (element: LayerElement) => void): void {
  visit(element);

  for (const child of element.props.children ?? []) {
    if (typeof child !== 'string') walkElements(child, visit);
  }
}

/** Every image reference of a layer: `<img src>` and CSS `url()`, unique, in document order. */
export function layerImageRefs(element: LayerElement): string[] {
  const refs: string[] = [];

  walkElements(element, (node) => {
    const found = [...(node.props.src ? [node.props.src] : []), ...Object.values(node.props.style).flatMap(cssUrlRefs)];

    for (const ref of found) if (!refs.includes(ref)) refs.push(ref);
  });

  return refs;
}

function inlineStyle(style: LayerStyle, images: ReadonlyMap<string, string>): LayerStyle {
  return Object.fromEntries(
    Object.entries(style).map(([key, value]) => [
      key,
      value.replace(
        /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi,
        (_match, a?: string, b?: string, c?: string) => {
          const data = images.get(a ?? b ?? c ?? '');

          return data === undefined ? 'none' : `url("${data}")`;
        }
      ),
    ])
  );
}

/** The layer with each image reference replaced by its `data:` URI; an image with none is dropped. */
export function inlineImages(element: LayerElement, images: ReadonlyMap<string, string>): LayerElement {
  const children = element.props.children?.flatMap((child): LayerChild[] => {
    if (typeof child === 'string') return [child];

    if (child.type === 'img' && !images.has(child.props.src ?? '')) return [];

    return [inlineImages(child, images)];
  });
  const src = element.props.src === undefined ? {} : { src: images.get(element.props.src) ?? '' };

  return {
    type: element.type,
    props: { ...element.props, ...src, style: inlineStyle(element.props.style, images), ...(children && { children }) },
  };
}

/**
 * Prepares a layer whose placeholders and theme tokens are already resolved. `custom` are the template's own
 * faces (`global.fonts`): a `font-family` naming one of their families uses them.
 */
export function prepareHtmlLayer(
  spec: HtmlLayerSpec,
  defaultFamily: string,
  custom: readonly CustomFontFace[] = []
): PreparedHtmlLayer {
  const sanitised = sanitiseHtml(parseHtml(spec.html));
  const sheet = parseStylesheet(spec.css ?? '');
  const styled = styleTree(sanitised.nodes, sheet);
  const laidOut = buildLayerElement(styled.nodes, {
    width: spec.width,
    height: spec.height,
    fontFamily: defaultFamily,
  });
  const fonts = layerFonts(laidOut, defaultFamily, custom);

  return {
    element: fonts.element,
    faces: fonts.faces,
    imageRefs: layerImageRefs(fonts.element),
    findings: [...sanitised.findings, ...sheet.findings, ...styled.findings],
    unknownFonts: fonts.unknown,
  };
}

export interface HtmlLayerKeyParts {
  element: LayerElement;
  /** Face identities (`file@weights`, a template face's declared weight and style appended). */
  fonts: string[];
  width: number;
  height: number;
  /** The rasteriser's own version (its Satori and resvg builds). */
  renderer?: string;
}

/** The content hash naming a rendered layer: same parts, same file, on every platform. */
export function htmlLayerKey(parts: HtmlLayerKeyParts): string {
  const payload = { ...parts, density: HTML_LAYER_DENSITY, layout: HTML_LAYOUT_VERSION };

  return sha256Hex(canonicalJson(payload)).slice(0, 16);
}
