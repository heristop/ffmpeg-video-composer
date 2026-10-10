// What a render of an HTML layer reports about it, in one place for the asset stage (which logs them) and the
// builder's live preview (which shows them next to the code): the placeholders nothing filled, the markup and
// CSS the subset dropped, the fonts the registry does not know, and content taller than the box.

import { fillHtmlPlaceholders, prepareHtmlLayer, type PreparedHtmlLayer } from '@/core/html/html-layer';
import type { CustomFontFace } from '@/core/html/template-fonts';

export type HtmlLayerFindingCode =
  | 'html_unsupported_markup'
  | 'html_unsupported_css'
  | 'html_font_unknown'
  | 'html_missing_field'
  | 'html_overflow';

export interface HtmlLayerFinding {
  code: HtmlLayerFindingCode;
  message: string;
  /** The field the finding is about. */
  source: 'html' | 'css';
}

export interface HtmlLayerSource {
  html?: string;
  css?: string;
  width?: number;
  height?: number;
}

/** The layer filled and prepared, with the findings in the order a render reports them. */
export function prepareWithFindings(
  input: HtmlLayerSource,
  lookup: (name: string) => string | undefined,
  defaultFamily: string,
  custom: readonly CustomFontFace[] = []
): { prepared: PreparedHtmlLayer; findings: HtmlLayerFinding[] } {
  const filled = fillHtmlPlaceholders(input.html ?? '', lookup);
  const css = input.css ?? '';
  const prepared = prepareHtmlLayer(
    { html: filled.html, css, width: input.width ?? 0, height: input.height ?? 0 },
    defaultFamily,
    custom
  );
  const fonts = prepared.unknownFonts.map((name): HtmlLayerFinding => ({
    code: 'html_font_unknown',
    message: `font "${name}" is neither declared in global.fonts nor in the font registry, ${defaultFamily} is used instead`,
    source: css.includes(name) ? 'css' : 'html',
  }));
  const missing = filled.missing.map((name): HtmlLayerFinding => ({
    code: 'html_missing_field',
    message: `{{ ${name} }} has no value`,
    source: 'html',
  }));

  return { prepared, findings: [...prepared.findings, ...fonts, ...missing] };
}

/** html_overflow when the content is taller than the box (a pixel of rounding allowed). */
export function overflowFinding(contentHeight: number, height: number): HtmlLayerFinding[] {
  if (contentHeight <= height + 1) return [];

  return [
    {
      code: 'html_overflow',
      message: `the content is ${Math.round(contentHeight)} px tall in a ${height} px box, the rest is cut`,
      source: 'css',
    },
  ];
}
