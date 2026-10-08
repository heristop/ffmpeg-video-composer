// The CSS subset of an HTML layer: the properties Satori lays out and paints, camel-cased into the inline
// style object it reads. Everything else is dropped and reported (html_unsupported_css), as are values it
// cannot honour: calc(), url() off the template's assets, display or position modes it lacks.

import type { CssDeclaration } from './css-parse';
import { firstGroup } from './html-entities';
import { isSafeAssetRef, type HtmlFinding, type HtmlFindingSource } from './html-sanitise';

const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

/** Every supported property, kebab-case as authored. */
export const HTML_CSS_PROPERTIES: readonly string[] = [
  'display',
  'position',
  ...SIDES,
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin',
  ...SIDES.map((side) => `margin-${side}`),
  'padding',
  ...SIDES.map((side) => `padding-${side}`),
  'border',
  ...SIDES.map((side) => `border-${side}`),
  'border-width',
  'border-style',
  'border-color',
  ...SIDES.flatMap((side) => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`]),
  'border-radius',
  ...CORNERS.map((corner) => `border-${corner}-radius`),
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-content',
  'align-self',
  'justify-content',
  'gap',
  'row-gap',
  'column-gap',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-feature-settings',
  'text-align',
  'text-transform',
  'text-overflow',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-style',
  'text-shadow',
  'text-indent',
  'text-wrap',
  'line-height',
  'letter-spacing',
  'white-space',
  'word-break',
  'tab-size',
  'line-clamp',
  'background',
  'background-color',
  'background-image',
  'background-position',
  'background-size',
  'background-repeat',
  'background-clip',
  'transform',
  'transform-origin',
  'object-fit',
  'object-position',
  'opacity',
  'box-sizing',
  'box-shadow',
  'overflow',
  'filter',
  'clip-path',
  'mask-image',
  'mask-position',
  'mask-size',
  'mask-repeat',
  '-webkit-line-clamp',
  '-webkit-box-orient',
  '-webkit-text-stroke',
  '-webkit-text-stroke-width',
  '-webkit-text-stroke-color',
];

const SUPPORTED = new Set(HTML_CSS_PROPERTIES);

/** Values a property only takes from a list (anything else is dropped). */
const ENUMS: Readonly<Record<string, { values: readonly string[]; hint: string }>> = {
  display: { values: ['flex', 'block', 'contents', 'none', '-webkit-box'], hint: 'use flex, block, contents or none' },
  position: { values: ['relative', 'absolute', 'static'], hint: 'use relative, absolute or static' },
  overflow: { values: ['visible', 'hidden'], hint: 'use visible or hidden' },
};

/** Satori's inline style object: camel-cased keys, CSS values kept as written. */
export type LayerStyle = Record<string, string>;

export interface ConvertedStyle {
  style: LayerStyle;
  findings: HtmlFinding[];
}

function camelCase(property: string): string {
  if (property.startsWith('--')) return property;

  // `-webkit-text-stroke` → `WebkitTextStroke`, the React spelling Satori reads.
  return property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

const URL_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** The url() references of a CSS value, unquoted. */
export function cssUrlRefs(value: string): string[] {
  return [...value.matchAll(URL_REF)].map((match) => firstGroup(match, 1));
}

function valueProblem(property: string, value: string): string | null {
  const lowered = value.toLowerCase();

  if (lowered.includes('calc(')) return `css ${property}: ${value}: calc() is not supported`;

  if (/expression\(|javascript:|attr\(/.test(lowered)) return `css ${property}: ${value}: not allowed`;

  const refused = cssUrlRefs(value).find((ref) => !isSafeAssetRef(ref));

  if (refused !== undefined) {
    return `css ${property}: url(${refused}) refused, an image must be one of the template's assets`;
  }

  const allowed = ENUMS[property] as (typeof ENUMS)[string] | undefined;

  if (allowed && !allowed.values.includes(lowered)) return `css ${property}: ${value}: not supported (${allowed.hint})`;

  return null;
}

const FONT_STYLES = new Set(['italic', 'oblique', 'normal']);
const FONT_WEIGHTS = /^(?:[1-9]00|bold|bolder|lighter)$/i;
const FONT_SIZE = /^([\d.]+(?:px|em|rem|%|pt)|xx-small|x-small|small|medium|large|x-large|xx-large)(?:\/(\S+))?$/i;

/** `font: [style] [weight] size[/line-height] family` as its longhands; null when it does not parse. */
export function expandFontShorthand(value: string): CssDeclaration[] | null {
  const tokens = value.trim().split(/\s+/);
  const out: CssDeclaration[] = [];
  let index = 0;

  for (; index < tokens.length; index++) {
    const token = tokens[index];

    if (FONT_STYLES.has(token.toLowerCase())) {
      if (token.toLowerCase() !== 'normal') out.push({ property: 'font-style', value: token });

      continue;
    }

    if (!FONT_WEIGHTS.test(token)) break;

    out.push({ property: 'font-weight', value: token });
  }

  const size = FONT_SIZE.exec(tokens[index] ?? '');
  const family = tokens.slice(index + 1).join(' ');

  if (!size || family === '') return null;

  out.push({ property: 'font-size', value: size[1] });

  if (size[2]) out.push({ property: 'line-height', value: size[2] });

  out.push({ property: 'font-family', value: family });

  return out;
}

function expanded(declarations: CssDeclaration[], report: (message: string) => void): CssDeclaration[] {
  return declarations.flatMap((declaration) => {
    if (declaration.property !== 'font') return [declaration];

    const longhands = expandFontShorthand(declaration.value);

    if (!longhands) {
      report(`css font: ${declaration.value}: unreadable`);
    }

    return longhands ?? [];
  });
}

/** The inline style of a declaration list, with a finding for each property or value it dropped. */
export function toLayerStyle(declarations: CssDeclaration[], source: HtmlFindingSource = 'css'): ConvertedStyle {
  const findings: HtmlFinding[] = [];
  const style: LayerStyle = {};

  function report(message: string): void {
    findings.push({ code: 'html_unsupported_css', message, source });
  }

  for (const { property, value } of expanded(declarations, report)) {
    if (!property.startsWith('--') && !SUPPORTED.has(property)) {
      report(`css ${property}: not supported in HTML layers`);

      continue;
    }

    const problem = valueProblem(property, value);

    if (problem) {
      report(problem);

      continue;
    }

    style[camelCase(property)] = value;
  }

  return { style, findings };
}
