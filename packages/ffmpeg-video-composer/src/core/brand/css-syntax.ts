// packages/ffmpeg-video-composer/src/core/brand/css-syntax.ts
// Just enough CSS syntax for the brand reader, each a single linear pass over untrusted text: comments
// (string-aware), `prop: value` declarations and `selector { body }` rules.

/**
 * The index just past the string opened by the quote at `open` (escapes skipped). Like CSS, an unescaped line
 * break ends an unterminated (bad) string, so one stray quote can't swallow the rest of a sheet.
 */
function stringEnd(css: string, open: number): number {
  const quote = css[open];

  for (let i = open + 1; i < css.length; i++) {
    if (css[i] === '\\') {
      i++;
      continue;
    }

    if (css[i] === quote) return i + 1;

    if (css[i] === '\n' || css[i] === '\r' || css[i] === '\f') return i;
  }

  return css.length;
}

/**
 * Drops `/* ... *\/` comments in one pass, leaving quoted strings (`url("/img/*.png")`) whole; an
 * unterminated comment drops the rest.
 */
export function stripComments(css: string): string {
  const out: string[] = [];
  let from = 0;
  let i = 0;

  while (i < css.length) {
    const ch = css[i];

    if (ch === '"' || ch === "'") {
      i = stringEnd(css, i);
      continue;
    }

    if (ch !== '/' || css[i + 1] !== '*') {
      i++;
      continue;
    }

    out.push(css.slice(from, i));

    const close = css.indexOf('*/', i + 2);

    if (close === -1) return out.join('');

    from = close + 2;
    i = from;
  }

  out.push(css.slice(from));

  return out.join('');
}

function stripImportant(value: string): string {
  const bang = value.lastIndexOf('!');

  if (bang === -1 || !/^!\s*important\s*$/i.test(value.slice(bang))) return value;

  return value.slice(0, bang);
}

/** A property's name: CSS properties are case-insensitive, custom properties (`--brandColor`) are not. */
function propertyName(raw: string): string {
  const name = raw.trim();

  return name.startsWith('--') ? name : name.toLowerCase();
}

/** `prop: value` pairs from a block's text, split on `;`. */
export function declarations(text: string): [string, string][] {
  const found: [string, string][] = [];
  let start = 0;

  for (let i = 0; i <= text.length; i++) {
    const code = text.codePointAt(i);

    // ; { }
    if (i < text.length && code !== 59 && code !== 123 && code !== 125) continue;

    if (i > start) {
      const piece = text.slice(start, i);
      const colon = piece.indexOf(':');

      if (colon !== -1) {
        found.push([propertyName(piece.slice(0, colon)), stripImportant(piece.slice(colon + 1).trim())]);
      }
    }

    start = i + 1;
  }

  return found;
}

/** `selector { body }` rules in one pass; at-rule preludes like `@media` are replaced by the inner selector. */
export function rules(css: string): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  let start = 0;
  let selector: string | null = null;

  for (let i = 0; i < css.length; i++) {
    const ch = css.codePointAt(i);

    // { }
    if (ch !== 123 && ch !== 125) continue;

    if (ch === 123) {
      selector = css.slice(start, i);
      start = i + 1;
    }

    if (ch === 125) {
      if (selector !== null) found.push({ selector, body: css.slice(start, i) });

      selector = null;
      start = i + 1;
    }
  }

  return found;
}
