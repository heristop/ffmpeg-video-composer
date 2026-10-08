// The stylesheet of an HTML layer: rules of tag, `.class` and descendant selectors, applied as inline
// styles before layout (Satori only reads inline style). At-rules and every other selector form are
// dropped and reported.

import type { HtmlFinding } from './html-sanitise';

export interface CssDeclaration {
  property: string;
  value: string;
}

/** One compound of a selector: an optional tag and any number of classes (`span.tag.big`). */
export interface CssCompound {
  tag?: string;
  classes: string[];
}

export interface CssSelector {
  source: string;
  /** Ancestor-first compounds of a descendant selector (`.card p` → [.card, p]). */
  compounds: CssCompound[];
  /** Classes count 10, tags 1: enough to order the selectors this subset can express. */
  specificity: number;
}

export interface CssRule {
  selector: CssSelector;
  declarations: CssDeclaration[];
  /** Source order, the tie-break between equally specific rules. */
  order: number;
}

export interface Stylesheet {
  rules: CssRule[];
  findings: HtmlFinding[];
}

const COMPOUND = /^(\*|[a-zA-Z][a-zA-Z0-9-]*)?((?:\.[a-zA-Z_-][\w-]*)*)$/;
const IMPORTANT = /\s*!important\s*$/i;

function cssFinding(message: string): HtmlFinding {
  return { code: 'html_unsupported_css', message, source: 'css' };
}

/** Splits `text` on `separator` outside quotes and parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (quote) {
      if (char === quote) quote = '';

      continue;
    }

    if (char === '"' || char === "'") quote = char;

    if (char === '(') depth++;

    if (char === ')') depth = Math.max(0, depth - 1);

    if (char === separator && depth === 0 && !quote) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));

  return parts;
}

/** The declarations of a block or a `style` attribute, in source order. */
export function parseDeclarations(text: string): CssDeclaration[] {
  return splitTopLevel(text, ';').flatMap((part) => {
    const colon = part.indexOf(':');

    if (colon === -1) return [];

    const property = part.slice(0, colon).trim();
    const value = part
      .slice(colon + 1)
      .replace(IMPORTANT, '')
      .trim();

    if (property === '' || value === '') return [];

    return [{ property: property.startsWith('--') ? property : property.toLowerCase(), value }];
  });
}

function parseCompound(text: string): CssCompound | null {
  const match = COMPOUND.exec(text);

  if (!match || text === '') return null;

  const tag = match[1] && match[1] !== '*' ? match[1].toLowerCase() : undefined;
  const classes = match[2] ? match[2].slice(1).split('.') : [];

  return tag === undefined ? { classes } : { tag, classes };
}

function parseSelector(source: string): CssSelector | null {
  const compounds = source.split(/\s+/).map(parseCompound);

  if (compounds.some((compound) => compound === null)) return null;

  const parts = compounds as CssCompound[];
  const specificity = parts.reduce((sum, part) => sum + part.classes.length * 10 + (part.tag ? 1 : 0), 0);

  return { source, compounds: parts, specificity };
}

// The index just past the block that opens at `open` (a `{`), or the end of the text.
function blockEnd(css: string, open: number): number {
  let depth = 0;

  for (let index = open; index < css.length; index++) {
    if (css[index] === '{') depth++;

    if (css[index] === '}') depth--;

    if (depth === 0) return index + 1;
  }

  return css.length;
}

// An at-rule at `at`: skipped to its `;` or past its block. Returns where parsing resumes.
function skipAtRule(css: string, at: number, findings: HtmlFinding[]): number {
  const name = /^@[\w-]+/.exec(css.slice(at))?.[0] ?? '@';
  findings.push(cssFinding(`css ${name}: at-rules are not supported`));

  const semicolon = css.indexOf(';', at);
  const brace = css.indexOf('{', at);

  if (brace === -1 || (semicolon !== -1 && semicolon < brace)) return semicolon === -1 ? css.length : semicolon + 1;

  return blockEnd(css, brace);
}

function pushRules(prelude: string, body: string, sheet: Stylesheet): void {
  const declarations = parseDeclarations(body);

  for (const raw of splitTopLevel(prelude, ',')) {
    const source = raw.trim().replace(/\s+/g, ' ');
    const selector = parseSelector(source);

    if (!selector) {
      sheet.findings.push(
        cssFinding(`css selector "${source}": only tag, .class and descendant selectors are supported`)
      );

      continue;
    }

    sheet.rules.push({ selector, declarations, order: sheet.rules.length });
  }
}

/** The rules of a stylesheet, with a finding for every at-rule and selector it had to drop. */
export function parseStylesheet(source: string): Stylesheet {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const sheet: Stylesheet = { rules: [], findings: [] };
  let at = 0;

  while (at < css.length) {
    const next = css.slice(at).search(/\S/);

    if (next === -1) break;

    at += next;

    if (css[at] === '@') {
      at = skipAtRule(css, at, sheet.findings);

      continue;
    }

    const open = css.indexOf('{', at);

    if (open === -1) break;

    const end = blockEnd(css, open);
    pushRules(css.slice(at, open), css.slice(open + 1, end - 1), sheet);
    at = end;
  }

  return sheet;
}
