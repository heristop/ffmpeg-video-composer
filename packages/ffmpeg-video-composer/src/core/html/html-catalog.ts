// The `html` entry of motionCatalog(): what an HTML layer is, the subset it supports and a few layout
// recipes an agent can start from. Pure data; the lists are the ones the sanitiser and the CSS subset
// enforce, so the catalog cannot drift from the engine.

import { HTML_CSS_PROPERTIES } from './css-properties';
import { HTML_ALLOWED_TAGS } from './html-sanitise';
import { HTML_LAYER_MAX_SIZE } from './limits';

interface HtmlRecipe {
  use: string;
  /** The `global.fields` the recipe fills, with defaults. */
  fields: Record<string, { type: 'text'; default: string; maxLength: number }>;
  input: Record<string, unknown>;
}

export interface HtmlCatalog {
  description: string;
  shape: string;
  tags: readonly string[];
  attributes: string;
  css: readonly string[];
  selectors: string;
  layout: string;
  fonts: string;
  values: string;
  images: string;
  motion: string;
  limits: string;
  platforms: string;
  recipes: Record<'card' | 'badge' | 'priceTag' | 'twoColumnStat', HtmlRecipe>;
}

function text(defaultValue: string, maxLength = 60): { type: 'text'; default: string; maxLength: number } {
  return { type: 'text', default: defaultValue, maxLength };
}

const RECIPES: HtmlCatalog['recipes'] = {
  card: {
    use: 'An address or contact card over a photo: label, headline, detail.',
    fields: { address: text('12 rue des Lilas'), city: text('Lyon 3e') },
    input: {
      name: 'address_card',
      type: 'html',
      html: '<div class="card"><span class="tag">For sale</span><h2>{{ address }}</h2><p>{{ city }}</p></div>',
      css:
        '.card { display: flex; flex-direction: column; gap: 8px; padding: 28px 32px; border-radius: 24px; ' +
        'background: $color.surface; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35) } ' +
        '.tag { color: $color.accent; font: 600 24px $font.body; text-transform: uppercase; letter-spacing: 2px } ' +
        'h2 { margin: 0; color: $color.fg; font: 56px $font.display } p { margin: 0; color: $color.muted; font: 28px $font.body }',
      width: 640,
      height: 240,
      options: { position: '64:420', motion: { type: 'rise', duration: 0.6 } },
    },
  },
  badge: {
    use: 'A short pill label: "New", "Live", "Sold".',
    fields: { label: text('Just listed', 24) },
    input: {
      name: 'badge',
      type: 'html',
      html: '<div class="badge">{{ label }}</div>',
      css:
        '.badge { display: flex; align-self: flex-start; padding: 10px 22px; border-radius: 999px; ' +
        'background: $color.accent; color: $color.bg; font: 700 28px $font.body }',
      width: 360,
      height: 80,
      options: { position: '64:64', motion: { type: 'fade', duration: 0.4 } },
    },
  },
  priceTag: {
    use: 'A price with its unit and a struck-through old price.',
    fields: { price: text('420 000 €', 20), was: text('450 000 €', 20) },
    input: {
      name: 'price_tag',
      type: 'html',
      html: '<div class="tag"><span class="was">{{ was }}</span><span class="price">{{ price }}</span></div>',
      css:
        '.tag { display: flex; flex-direction: column; align-items: flex-end; padding: 18px 26px; border-radius: 18px; ' +
        'background: $color.brand } .was { color: $color.bg; font: 400 24px $font.body; text-decoration: line-through } ' +
        '.price { color: $color.bg; font: 64px $font.display }',
      width: 360,
      height: 150,
      options: { position: '856:64', motion: { type: 'slide-left', duration: 0.5 } },
    },
  },
  twoColumnStat: {
    use: 'Two figures side by side with their labels: a stat strip.',
    fields: { rooms: text('4', 6), area: text('92 m²', 12) },
    input: {
      name: 'stats',
      type: 'html',
      html:
        '<div class="row"><div class="stat"><strong>{{ rooms }}</strong><span>rooms</span></div>' +
        '<div class="stat"><strong>{{ area }}</strong><span>living area</span></div></div>',
      css:
        '.row { display: flex; gap: 16px } .stat { display: flex; flex-direction: column; flex-grow: 1; padding: 20px; ' +
        'border-radius: 16px; background: rgba(20, 20, 22, 0.75) } strong { color: $color.fg; font: 56px $font.display } ' +
        'span { color: $color.muted; font: 24px $font.body }',
      width: 560,
      height: 150,
      options: { position: '64:520', motion: { type: 'rise', duration: 0.6 } },
    },
  },
};

export function htmlCatalog(): HtmlCatalog {
  return {
    description:
      'inputs[] entry of type "html": HTML + CSS laid out with flexbox and drawn once to a transparent still ' +
      '(Satori + resvg, deterministic), then composited like an image input: position, scale, motion, start, ' +
      'duration and opacity work unchanged. For layout drawtext cannot do: cards, badges, price tags, stat rows.',
    shape: '{ name, type: "html", html, css?, width, height, options?: { position, motion, … } }',
    tags: HTML_ALLOWED_TAGS,
    attributes:
      'class and style everywhere; src, alt, width, height on img. Scripts, handlers, links, forms, iframes are removed.',
    css: HTML_CSS_PROPERTIES,
    selectors: 'tag, .class, tag.class and descendant (".card p"); no #id, pseudo-classes, > + ~ or @rules.',
    layout:
      'Everything is flexbox (Yoga): a container of block elements stacks as a column, text mixed with inline ' +
      'elements flows word by word. Set display: flex explicitly for rows. No grid, no float, no calc().',
    fonts:
      'Registry fonts only (Rubik, Oswald, Bebas Neue, Playfair Display, Roboto Mono, Anton…), by family, id or ' +
      '$font.display|body|mono; generic serif/monospace map to bundled faces. Unknown families fall back to the theme body font.',
    values:
      '{{ field }} in html takes global.fields, global.variables or form values, always HTML-escaped. ' +
      '$color.* (with @alpha) and $font.* tokens resolve inside css and style attributes.',
    images:
      'img src and url() must be template assets (relative or /assets/ paths, PNG/JPEG); remote images are refused.',
    motion:
      'The layer is a still: animate it with options.motion (rise, slide-*, fade), start/duration, camera and fx.',
    limits: `width and height in output pixels, ${HTML_LAYER_MAX_SIZE} max; drawn at 2× and scaled into the box. Content taller than the box is cut (html_overflow).`,
    platforms:
      'Node (CLI, MCP), the browser (web app) and the phone (a hidden WebView) render HTML layers, byte for ' +
      'byte alike.',
    recipes: RECIPES,
  };
}
