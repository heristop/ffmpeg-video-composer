// Descriptor rules for HTML layers (`inputs[]` entries of `type: "html"`):
//
// - html_too_large: the box is wider or taller than HTML_LAYER_MAX_SIZE output pixels.
// - html_unavailable: the engine has no HTML rasteriser registered: the template cannot render there, so it
//   is refused before any section is encoded.
// The advisories (html-advisories.ts) say what a layer drops; these are the hard errors.

import { HTML_LAYER_MAX_SIZE } from '@/core/html/limits';
import type { ValidationError } from './validation/types';

type Bag = Record<string, unknown>;

export interface HtmlInputUse {
  input: Bag;
  /** `sections[i].inputs[j]`, indexing the (partial-expanded) sections. */
  path: string;
}

function list(value: unknown): Bag[] {
  return Array.isArray(value) ? value.filter((item): item is Bag => item !== null && typeof item === 'object') : [];
}

/** Every HTML layer input of a descriptor, with its path. */
export function htmlInputs(template: unknown): HtmlInputUse[] {
  const sections = list((template as { sections?: unknown } | null)?.sections);

  return sections.flatMap((section, i) =>
    list(section.inputs).flatMap((input, j) =>
      input.type === 'html' ? [{ input, path: `sections[${i}].inputs[${j}]` }] : []
    )
  );
}

function sizeErrors({ input, path }: HtmlInputUse): ValidationError[] {
  return (['width', 'height'] as const).flatMap((side) => {
    const value = input[side];

    if (typeof value !== 'number' || value <= HTML_LAYER_MAX_SIZE) return [];

    return [
      {
        path: `${path}.${side}`,
        code: 'html_too_large',
        message: `html layer ${side} ${value} px is over the ${HTML_LAYER_MAX_SIZE} px limit`,
        hint: `Keep the box within ${HTML_LAYER_MAX_SIZE}×${HTML_LAYER_MAX_SIZE}; scale it up with options.scale if it must cover more.`,
        suggestion: HTML_LAYER_MAX_SIZE,
        kind: 'judgement' as const,
      },
    ];
  });
}

export function validateHtmlBoxes(template: unknown): ValidationError[] {
  return htmlInputs(template).flatMap(sizeErrors);
}

export function validateHtmlAvailability(template: unknown, canRender: boolean): ValidationError[] {
  if (canRender) return [];

  return htmlInputs(template).map(({ path }) => ({
    path,
    code: 'html_unavailable',
    message:
      'this engine has no HTML rasteriser registered: a browser host passes BrowserCompileOptions.loadHtmlWasm ' +
      '(the WebAssembly it serves), a React Native host calls registerHtmlRasteriser',
    hint:
      'give the host its rasteriser as above (the web app and the LeClap app do), render this template with the ' +
      'Node engine (leclap render, the MCP server), or replace the layer with an image input rendered from it',
  }));
}
