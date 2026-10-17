import path from 'node:path';

import type { TemplateDescriptor } from 'ffmpeg-video-composer';

import { assertMediaRefsLocal } from './media-refs.js';

// compose_video schema-validates the descriptor but then forwards its filter chain to ffmpeg
// VERBATIM (FilterSchema.type is a raw filter name, and the scalar `value` becomes `type=value`;
// the core's stripFilterUnsafe removes only quotes/spaces). Only userVideoPaths get the media-dir
// guard, so without this an agent-supplied template can reach the host filesystem/network THROUGH
// the filtergraph, sidestepping the sandbox. Two escape channels, both closed here:
//
//   1. A filter TYPE that itself opens an external resource: source filters (movie/amovie), subtitle
//      readers (subtitles/ass), and plugin loaders (frei0r/ladspa/lv2/…) → arbitrary read + SSRF +
//      code load. Rejected outright.
//   2. A file/URL smuggled through the scalar `value` of ANY filter, e.g. `{type:"curves",
//      value:"psfile=/etc/passwd"}` → `curves=psfile=/etc/passwd` reads a local file, or
//      `value:"http://169.254.169.254/…"` → SSRF via libavformat. Rejected by token scan below.
//
// The structured `values` object cannot smuggle a path: its schema strips unknown keys, and the one
// path-bearing key it does define (`fontfile`) is realpath-contained to the media dir here.
//
// NOTE: this is defense-in-depth over an intentionally permissive surface (raw filter passthrough).
// It blocks the known escape classes; the provably-complete alternative is a positive filter-type
// allowlist, which would also reject legitimate uncommon filters — a deliberate trade-off.

// Filter types that read a file / fetch a URL / load a plugin. A normal template never needs one —
// media arrives as sections/inputs (which ARE guarded).
const DANGEROUS_FILTERS = new Set([
  'movie',
  'amovie',
  'subtitles',
  'ass',
  'frei0r',
  'frei0r_src',
  'ladspa',
  'lv2',
  'openclsrc',
  'coreimage',
  'coreimagesrc',
  // Command/network/model loaders: sendcmd reads a command file, zmq/azmq open a listening socket,
  // arnndn loads a model file.
  'sendcmd',
  'asendcmd',
  'zmq',
  'azmq',
  'arnndn',
  // Filters that read a file or a model given as an option (LUT, SOFA, mask, OCR data, whisper model).
  'lut1d',
  'haldclut',
  'sofalizer',
  'whisper',
  'cover_rect',
  'find_rect',
  'removelogo',
  'ocr',
]);

// Every dnn_* filter loads a model file.
function dangerousFilter(type: string): boolean {
  const name = type.replace(/\\/g, '').trim().toLowerCase();

  return DANGEROUS_FILTERS.has(name) || name.startsWith('dnn_');
}

// A URL/pseudo-protocol scheme anywhere in a value → SSRF or protocol-based file access.
const PSEUDO_PROTOCOL =
  /(^|[^a-z0-9])(concat|subfile|async|cache|data|file|pipe|fd|crypto|http|https|ftp|ftps|sftp|tcp|udp|rtmp|rtp|rtsp|srtp|tls|unix|gopher|md5|hls):/i;
// A file-bearing filter OPTION token (curves=psfile=…, drawtext=textfile=…, movie=filename=…, …).
// Quotes are stripped before matching, so 'psfile'=… and "textfile"=… are caught too.
const FILE_OPTION =
  /(^|[\s,:;=])(psfile|filename|textfile|pfile|fontfile|model|model_filename|commands|file|stats_file|m|sofa|cover|object|datapath|dumpfile|log_path|destination)\s*=/i;
// A value that is itself an absolute path or a traversal.
const ABSOLUTE_OR_TRAVERSAL = /^\s*(\/|[a-zA-Z]:[\\/])|(^|[\\/])\.\.([\\/]|$)/;

// Filtergraph syntax that opens a resource, as it reads once chained into a graph: a source/plugin
// filter or a file-bearing option right after a filter separator (`;`, `,`, `]`, `:`, `=`) or at the
// start of the string, e.g. `red;movie=/etc/passwd` in a colour that lands in a `color=c=…` source.
// Every string leaf is scanned with these, because a template field the filter scan never reads (a
// transition colour, a theme value) can still reach a filtergraph. They need the filter-name-then-`=`
// shape after a separator, so free copy ("Hello; world", "watch the movie, then…", a URL) passes.
// zmq/azmq run with no options, so they also match bare before a separator or the end. The short
// generic option names (`f`, `file`) only match in option position, glued to the `=` or `:` before
// them (`sendcmd=f=…`, `drawtext=…:file=…`); FFmpeg reads no whitespace around an option key.
// Quotes and backslashes are stripped first: FFmpeg's tokenizer unescapes `mo\vie` to `movie`.
const CHAINED_FILTER = new RegExp(`(^|[;,\\]])\\s*(${[...DANGEROUS_FILTERS].join('|')})(@\\w*)?\\s*=`, 'i');
const CHAINED_BARE_FILTER = /(^|[;,\]])\s*a?zmq(@\w*)?\s*($|[;,[])/i;
const CHAINED_FILE_OPTION = /(^|[;,\]:=])\s*(psfile|filename|textfile|pfile|fontfile|model_filename|stats_file)\s*=/i;
const OPTION_FILE = /[=:](f|file)=/i;
const CHAINED_PATTERNS = [CHAINED_FILTER, CHAINED_BARE_FILTER, CHAINED_FILE_OPTION, OPTION_FILE];

export type GuardResult = { ok: true } | { ok: false; message: string };

// Recursively yield every plain object node in the descriptor (arrays and objects), so the walk
// catches filters wherever they live: section filters, per-input filters, and map filter chains.
function* objectNodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* objectNodes(item);
    }

    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  yield record;

  for (const child of Object.values(record)) {
    yield* objectNodes(child);
  }
}

// A bare bundled font name (e.g. "BebasNeue.ttf") has no path separator and no traversal — those
// resolve from the engine's font registry and are safe. Anything path-like must be contained.
// Aligned with the engine (assertBareFontFile): a drawtext fontfile is a bare font name the engine stages.
function fontfileIsNotBare(fontfile: string): boolean {
  return /[/\\':]/.test(fontfile) || fontfile.includes('..') || path.isAbsolute(fontfile);
}

// One FFmpeg tokenizer pass: '…' is literal, \x is x, an unquoted terminator splits.
function splitUnescaped(input: string, terminators: string): string[] {
  const parts = [''];

  for (let index = 0; index < input.length; index++) {
    const char = input[index];

    if (char === '\\') {
      parts[parts.length - 1] += input[index + 1] ?? '';
      index++;
      continue;
    }

    if (char === "'") {
      const close = input.indexOf("'", index + 1);
      const end = close === -1 ? input.length : close;
      parts[parts.length - 1] += input.slice(index + 1, end);
      index = end;
      continue;
    }

    if (terminators.includes(char)) {
      parts.push('');
      continue;
    }

    parts[parts.length - 1] += char;
  }

  return parts;
}

// A protocol prefix (file:, http:, data:, concat:, subfile:…) on an option's value as FFmpeg reads it,
// after both its passes (graph, then option): `'file\:/x'` is `file:/x` there. drawtext text is copy.
const PROTOCOL_PREFIX = /^\s*[A-Za-z][\w+.-]*:/;

function hasProtocolOption(value: string): boolean {
  return splitUnescaped(value, '[];,')
    .flatMap((filter) => splitUnescaped(filter, ':'))
    .some((option) => {
      const equals = option.indexOf('=');

      if (equals >= 0 && option.slice(0, equals).trim() === 'text') return false;

      return PROTOCOL_PREFIX.test(equals < 0 ? option : option.slice(equals + 1));
    });
}

function unsafeScalarValueReason(value: string): string | undefined {
  const unquoted = value.replace(/["'`\\]/g, '');

  if (unquoted.includes('://') || PSEUDO_PROTOCOL.test(unquoted) || hasProtocolOption(value)) {
    return 'contains a URL/protocol scheme';
  }

  if (FILE_OPTION.test(unquoted)) {
    return 'references a file via a filter option';
  }

  if (ABSOLUTE_OR_TRAVERSAL.test(unquoted)) {
    return 'contains an absolute path or a traversal';
  }

  return undefined;
}

// Every string a filter hands to ffmpeg: the scalar `value` plus the structured `values` leaves.
// Caption text and fontfile are excluded: text is free copy (a URL in a caption is not a fetch) and
// fontfile has its own bare-name rule below.
function filterStrings(node: Record<string, unknown>): string[] {
  const strings: string[] = [];

  if (typeof node.value === 'string') {
    strings.push(node.value);
  }

  function collect(value: unknown): void {
    if (typeof value === 'string') {
      strings.push(value);

      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collect(item);
      }

      return;
    }

    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key !== 'text' && key !== 'fontfile') {
          collect(child);
        }
      }
    }
  }

  collect(node.values);

  return strings;
}

// Section/transition `type` values are enum-constrained by the schema (already validated), so a
// `type` equal to a dangerous filter name can only be a raw filter entry — no false positives.
// Also scans each filter's `value` and `values` strings for a smuggled file/URL token.
function findFilterEscape(descriptor: TemplateDescriptor): string | undefined {
  for (const node of objectNodes(descriptor)) {
    const type = node.type;

    if (typeof type !== 'string') {
      continue;
    }

    if (dangerousFilter(type)) {
      return `Filter "${type.trim()}" is not allowed: it can read arbitrary files or URLs. Supply media via userVideoPaths (checked against the media dir) instead.`;
    }

    for (const value of filterStrings(node)) {
      const reason = unsafeScalarValueReason(value);

      if (reason) {
        return `Filter "${type}" value ${reason}: refusing to forward a path/URL to ffmpeg.`;
      }
    }
  }

  return undefined;
}

// Every string leaf of the descriptor with its path (`sections[0].transition.color`).
function* stringLeaves(value: unknown, at: string): Generator<[string, string]> {
  if (typeof value === 'string') {
    yield [at, value];

    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      yield* stringLeaves(item, `${at}[${index}]`);
    }

    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    yield* stringLeaves(child, at ? `${at}.${key}` : key);
  }
}

// A source/plugin filter or a file option chained into ANY string field (see CHAINED_FILTER).
function findChainedEscape(descriptor: TemplateDescriptor): string | undefined {
  for (const [at, value] of stringLeaves(descriptor, '')) {
    const unescaped = value.replace(/["'`\\]/g, '');

    if (CHAINED_PATTERNS.some((pattern) => pattern.test(unescaped))) {
      return `Field "${at}" contains FFmpeg filter syntax that reads a file or URL: refusing to forward it to ffmpeg.`;
    }
  }

  return undefined;
}

function collectFontfiles(descriptor: TemplateDescriptor): string[] {
  const files: string[] = [];

  for (const node of objectNodes(descriptor)) {
    if (typeof node.fontfile === 'string') {
      files.push(node.fontfile);
    }
  }

  return files;
}

// Reject dangerous filter types, file/URL-bearing scalar values and source/file filter syntax in any
// string field, a fontfile that is not a bare font name, and any local media path outside the media dir
// (media-refs.ts, realpath-checked so symlink-safe, hence async).
export async function assertDescriptorSafe(descriptor: TemplateDescriptor, mediaDir: string): Promise<GuardResult> {
  const escape = findFilterEscape(descriptor) ?? findChainedEscape(descriptor);

  if (escape) {
    return { ok: false, message: escape };
  }

  const pathLike = collectFontfiles(descriptor).find(fontfileIsNotBare);

  if (pathLike !== undefined) {
    return {
      ok: false,
      message:
        `fontfile "${pathLike}" must be a bare font name such as "Oswald.ttf"; a font file from the media dir ` +
        'is declared in global.fonts instead.',
    };
  }

  return assertMediaRefsLocal(descriptor, mediaDir);
}
