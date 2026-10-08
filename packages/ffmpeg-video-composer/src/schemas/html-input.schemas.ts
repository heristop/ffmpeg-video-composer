import { z } from 'zod';

// The fields of an HTML layer input (`type: "html"`), spread into InputSchema. The box is bounded by the
// descriptor rule html_too_large (services/html-validation.ts) rather than here, so the finding names the
// limit and the fix instead of zod's bare "too big".

/** Generous for a card and far below anything that would stall a render. */
const MAX_SOURCE_LENGTH = 20_000;

export const HtmlInputShape = {
  html: z
    .string()
    .max(MAX_SOURCE_LENGTH)
    .optional()
    .describe('html layer: markup (div, span, p, h1-h6, strong, em, img…); {{ var }} values are HTML-escaped.'),
  css: z
    .string()
    .max(MAX_SOURCE_LENGTH)
    .optional()
    .describe('html layer: stylesheet (tag, .class, descendant selectors; flexbox subset); $color.*/$font.* tokens.'),
  width: z.number().int().positive().optional().describe('html layer: box width in output pixels (max 1920).'),
  height: z.number().int().positive().optional().describe('html layer: box height in output pixels (max 1920).'),
};

const HTML_KEYS = ['html', 'css', 'width', 'height'] as const;
const REQUIRED = ['html', 'width', 'height'] as const;

type HtmlInputFields = { type?: string; url?: string } & Partial<Record<(typeof HTML_KEYS)[number], unknown>>;

/** An html input needs its markup and box and takes no url; the html fields belong to html inputs only. */
export function htmlInputIssues(input: HtmlInputFields, ctx: z.RefinementCtx): void {
  if (input.type !== 'html') {
    for (const key of HTML_KEYS.filter((name) => input[name] !== undefined)) {
      ctx.addIssue({ code: 'custom', path: [key], message: `"${key}" belongs to an html input (type: "html")` });
    }

    return;
  }

  for (const key of REQUIRED.filter((name) => input[name] === undefined)) {
    ctx.addIssue({ code: 'custom', path: [key], message: `an html input needs "${key}"` });
  }

  if (input.url !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'an html input is drawn from its html, it takes no url' });
  }
}
