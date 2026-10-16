// Raw filter `values` are an authoring feature: any drawtext/drawbox option reaches FFmpeg as
// `key=value`, so the formatter cannot allow-list keys. These guards refuse what turns a value into a
// file read or a second option instead. FFmpeg reads a filter's options in two passes (libavfilter's
// av_get_token): the graph pass un-quotes '…' and un-escapes \x up to an unquoted `[` `]` `;` `,`,
// then the option pass splits that text on unquoted `:`. A value that stops either pass early ends
// its filter or adds an option of its own (e.g. `textfile=`), whatever quoting it uses.

/** Option keys that make a filter read a file: refused in authored raw values. */
const FILE_OPTION_KEYS = new Set([
  'textfile',
  'filename',
  'file',
  'f',
  'psfile',
  'pfile',
  'model_filename',
  'stats_file',
]);

interface Token {
  /** Unquoted, unescaped text up to the terminator. */
  value: string;
  /** What follows the terminator (empty when the input was consumed). */
  rest: string;
  /** A quote was left open. */
  open: boolean;
}

// One av_get_token: \x is a literal x, '…' is literal text, an unquoted terminator ends the token.
function readToken(input: string, terminators: string): Token {
  let value = '';
  let index = 0;

  while (index < input.length && !terminators.includes(input[index])) {
    const char = input[index];

    if (char === '\\') {
      value += input[index + 1] ?? '';
      index += 2;
      continue;
    }

    if (char === "'") {
      const end = input.indexOf("'", index + 1);

      if (end === -1) return { value: value + input.slice(index + 1), rest: '', open: true };

      value += input.slice(index + 1, end);
      index = end + 1;
      continue;
    }

    value += char;
    index++;
  }

  return { value, rest: input.slice(index), open: false };
}

/** Why `value` would leave its `key=value` option, or null when it stays one option of one filter. */
function optionEscape(value: string): string | null {
  const graph = readToken(value, '[];,');

  if (graph.open) return 'leaves a quote open';

  if (graph.rest) return 'ends the filter (unquoted , ; [ or ])';

  const option = readToken(graph.value, ':');

  if (option.open) return 'leaves a quote open';

  if (option.rest) return 'adds another option (unescaped :)';

  return null;
}

/** Refuses a file-reading option key or a value that escapes its option; returns the value. */
export function assertSafeFilterValue(key: string, value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Unsafe filter value key "${key}": not an option name`);

  if (FILE_OPTION_KEYS.has(key)) {
    throw new Error(`Unsafe filter value ${key}: the option reads a file, which raw filter values cannot do`);
  }

  const escape = optionEscape(value);

  if (escape) throw new Error(`Unsafe filter value ${key}: "${value}" ${escape}`);

  return value;
}

/**
 * A drawtext `fontfile` is a bare font file name staged under the build's fonts dir (bundled, cached,
 * catalog or downloaded): a path, a traversal, a quote or a `:` would read another file or add options.
 */
export function assertBareFontFile(file: string): string {
  if (/[/\\':]/.test(file) || file.includes('..')) {
    throw new Error(`Unsafe fontfile "${file}": a font is a bare file name such as "Rubik.ttf", staged by the engine`);
  }

  return file;
}
