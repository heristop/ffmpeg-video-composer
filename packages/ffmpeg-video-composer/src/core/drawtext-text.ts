// How display text reaches drawtext's `text='…'` option intact. The value is read by three parsers in
// turn, and each one consumes its own escapes:
//
//   1. the filtergraph parser, which honours the single quotes around the value (inside them every
//      character is literal, `, ; [ ] =` included);
//   2. the filter's option parser, which splits `key=value` pairs on `:` and treats `\` as an escape;
//   3. drawtext's own text expansion, where `%` starts a `%{…}` sequence and `\` escapes again.
//
// So `:` needs one backslash (level 2), while `\` and `%` need escaping for levels 2 AND 3. The single
// and double quotes cannot be escaped inside a quoted value at all — a straight `'` would end the
// quoted span (level 1) and a `"` would end the `-vf "…"` argv token the command is split on — so they
// are drawn as their typographic forms, which every bundled font has and which the geometry
// measurements already assume. Everything else, including newlines, emoji and CJK, passes through as
// UTF-8 bytes. tests/drawtext-text.test.ts proves the round trip against a real FFmpeg.

const ESCAPES: Readonly<Record<string, string>> = {
  ':': String.raw`\:`,
  '%': String.raw`\\\%`,
  '\\': String.raw`\\\\`,
};

// Control characters other than tab and newline: a NUL would truncate the argv string.
function keepDrawableControl(char: string): string {
  return char === '\n' || char === '\t' ? char : '';
}

/** The text drawtext will draw for an authored string: straight quotes become typographic ones. */
export function typographicText(text: string): string {
  return text.replace(/'/g, '’').replace(/"/g, '”');
}

/**
 * Escapes text for a single-quoted drawtext `text='…'` value. FFmpeg then draws exactly
 * `typographicText(text)`, minus control characters other than tab/newline and minus leading/trailing
 * whitespace (the option parser trims it).
 */
export function escapeDrawtextText(text: string): string {
  return typographicText(text)
    .replace(/\p{Cc}/gu, keepDrawableControl)
    .replace(/[:%\\]/g, (char: string) => ESCAPES[char] ?? char);
}
