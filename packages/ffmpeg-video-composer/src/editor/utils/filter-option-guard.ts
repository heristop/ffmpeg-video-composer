// Raw filter `values` are an authoring feature: any drawtext/drawbox option reaches FFmpeg as
// `key=value`, so the formatter cannot allow-list keys. These guards refuse what turns a value into a
// file read or a second option instead. FFmpeg reads a filter's options in two passes (libavfilter's
// av_get_token): the graph pass un-quotes '…' and un-escapes \x up to an unquoted `[` `]` `;` `,`,
// then the option pass splits that text on unquoted `:`. A value that stops either pass early ends
// its filter or adds an option of its own (e.g. `textfile=`), whatever quoting it uses.

/** Option keys that make a filter read or write a file, or run commands: refused in raw values. */
const FILE_OPTION_KEYS = new Set([
  'textfile',
  'filename',
  'file',
  'f',
  'psfile',
  'pfile',
  'model_filename',
  'stats_file',
  'model',
  'm',
  'sofa',
  'cover',
  'object',
  'datapath',
  'dumpfile',
  'log_path',
  'destination',
  'commands',
]);

/**
 * Filters that read files, run commands, open sockets or load plugins/models: refused as raw filter
 * types. `lut3d` is not here: its value names a LUT the engine stages (formatLut3d), never a path.
 */
const UNSAFE_FILTER_TYPES = new Set([
  'movie',
  'amovie',
  'subtitles',
  'ass',
  'sendcmd',
  'asendcmd',
  'lut1d',
  'haldclut',
  'zmq',
  'azmq',
  'ladspa',
  'lv2',
  'frei0r',
  'arnndn',
  'sofalizer',
  'whisper',
  'cover_rect',
  'find_rect',
  'removelogo',
  'ocr',
]);

export interface Token {
  /** Unquoted, unescaped text up to the terminator. */
  value: string;
  /** What follows the terminator (empty when the input was consumed). */
  rest: string;
  /** A quote or a trailing escape was left open. */
  open: boolean;
}

// One av_get_token: \x is a literal x, '…' is literal text, an unquoted terminator ends the token.
export function readToken(input: string, terminators: string): Token {
  let value = '';
  let index = 0;

  while (index < input.length && !terminators.includes(input[index])) {
    const char = input[index];

    // A trailing backslash is kept by FFmpeg and escapes whatever the engine writes next.
    if (char === '\\' && index === input.length - 1) return { value, rest: '', open: true };

    if (char === '\\') {
      value += input[index + 1];
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

/** An absolute path (`/x`, `~/x`, `C:\\x`) or a `..` traversal. */
const PATH_LIKE = /^\s*(\/|~|[A-Za-z]:[\\/])|(^|[\\/])\.\.([\\/]|$)/;

/**
 * A protocol prefix (`file:`, `http:`, `data:`, `concat:`, `subfile:`…) as FFmpeg reads the value once
 * unescaped: `'file\:/x'` opens a file and `'http\://…'` a URL wherever a filter takes a path. A time
 * (`00:00:01`) starts with a digit, so it never matches.
 */
const PROTOCOL = /^\s*[A-Za-z][\w+.-]*:/;

/** Why an option value, unescaped, would name a file or a URL; null when it does not. */
function locationProblem(value: string, isText = false): string | null {
  if (PATH_LIKE.test(value)) return 'passes a file path';

  // drawtext text is copy, never opened: "Note: …" stays text.
  return !isText && PROTOCOL.test(value) ? 'passes a protocol (file:, http:…)' : null;
}

/** Why `value` would leave its `key=value` option, or null when it stays one option of one filter. */
function optionEscape(value: string): string | null {
  const graph = readToken(value, '[];,');

  if (graph.open) return 'leaves a quote or an escape open';

  if (graph.rest) return 'ends the filter (unquoted , ; [ or ])';

  const option = readToken(graph.value, ':');

  if (option.open) return 'leaves a quote or an escape open';

  if (option.rest) return 'adds another option (unescaped :)';

  return null;
}

/** Why a `values` entry is unsafe (a file-reading key, a value leaving its option, a path or a protocol). */
export function filterValueProblem(key: string, value: string): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `key "${key}" is not an option name`;

  if (FILE_OPTION_KEYS.has(key)) return `${key} reads a file, which raw filter values cannot do`;

  const escape = optionEscape(value) ?? locationProblem(readToken(readToken(value, '[];,').value, ':').value);

  return escape ? `${key}: "${value}" ${escape}` : null;
}

/** Refuses a file-reading option key or a value that escapes its option; returns the value. */
export function assertSafeFilterValue(key: string, value: string): string {
  const problem = filterValueProblem(key, value);

  if (problem) throw new Error(`Unsafe filter value ${problem}`);

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

/**
 * A filtergraph pad label (`[label]`): a stream (`0:v`), an `@input` reference or a plain name. A `]`,
 * `[`, `;` or `,` in an author's input name would close the label and splice its own graph in.
 */
export function assertSafePadLabel(label: string): string {
  if (!/^[A-Za-z0-9_.:@-]+$/.test(label)) {
    throw new Error(`Unsafe pad label "${label}": use letters, digits, "_" or "-" in input names`);
  }

  return label;
}

/** A raw filter name: lower-case letters, digits and `_`, and not a file- or command-capable filter. */
export function assertSafeFilterType(type: string): string {
  if (!/^[a-z0-9_]+$/.test(type)) throw new Error(`Unsafe filter type "${type}": not a filter name`);

  if (UNSAFE_FILTER_TYPES.has(type) || type.startsWith('dnn_')) {
    throw new Error(`Unsafe filter type "${type}": it reads files, runs commands or loads models`);
  }

  return type;
}

/** Checks one option of a filter: a file-reading key, a path or protocol value, positional drawtext. */
function checkOption(type: string, option: { value: string }, value: string): void {
  const equals = option.value.indexOf('=');
  const key = equals < 0 ? null : option.value.slice(0, equals).trim();

  if (key !== null && FILE_OPTION_KEYS.has(key)) {
    throw new Error(`Unsafe filter value ${type}: option ${key} reads a file, which raw filter values cannot do`);
  }

  // A positional option can be a file option (metadata's 6th, psnr's 1st, curves' 7th): a value that
  // reads as an absolute path, a traversal or a protocol is refused whatever its slot or key.
  const optionValue = equals < 0 ? option.value : option.value.slice(equals + 1);
  const location = locationProblem(optionValue, key === 'text');

  if (location) throw new Error(`Unsafe filter value ${type}: "${value}" ${location}`);

  if (key === 'fontfile' && type === 'drawtext') assertBareFontFile(optionValue);

  if (key === null && type === 'drawtext') {
    throw new Error(`Unsafe filter value ${type}: positional options are not allowed (the first is fontfile)`);
  }
}

/** Checks one filter's options (graph-level text already split off): keys, positional drawtext, quotes. */
function checkOptions(type: string, options: string, value: string): void {
  let rest = options;

  while (rest.length > 0) {
    const option = readToken(rest, ':');

    if (option.open) throw new Error(`Unsafe filter value ${type}: "${value}" leaves a quote or an escape open`);

    checkOption(type, option, value);

    rest = option.rest.slice(1);
  }
}

/**
 * A scalar `value` (`type=value`) may hold several options (`1280:720:color=black`) and may chain
 * further filters with `,` (the engine's own `scale=…,crop=…`). Each chained filter is checked like a
 * raw filter: a safe type, no file-reading option, no positional drawtext option, no open quote or
 * escape. A `;`, `[` or `]` would start another chain or relabel pads, so it is refused.
 */
export function assertSafeFilterOptions(type: string, value: string): string {
  let current = type;
  let rest = value;

  for (;;) {
    const piece = readToken(rest, '[];,');

    if (piece.open) throw new Error(`Unsafe filter value ${type}: "${value}" leaves a quote or an escape open`);

    checkOptions(current, piece.value, value);

    if (!piece.rest) return value;

    if (piece.rest[0] !== ',') throw new Error(`Unsafe filter value ${type}: "${value}" leaves its filter chain`);

    const next = /^([^=,;[\]]*)(=|(?=[,;[\]])|$)/.exec(piece.rest.slice(1));
    const name = next?.[1] ?? '';

    current = assertSafeFilterType(name);
    rest = piece.rest.slice(1 + (next?.[0].length ?? 0));
  }
}
