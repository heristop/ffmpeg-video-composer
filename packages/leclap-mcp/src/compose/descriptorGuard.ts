import path from 'node:path';

import type { TemplateDescriptor } from 'ffmpeg-video-composer';

import { assertWithinMediaDir } from './pathGuard.js';

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
]);

// A URL/pseudo-protocol scheme anywhere in a value → SSRF or protocol-based file access.
const PSEUDO_PROTOCOL =
  /(^|[^a-z0-9])(concat|subfile|async|cache|data|file|pipe|fd|crypto|http|https|ftp|ftps|sftp|tcp|udp|rtmp|rtp|rtsp|srtp|tls|unix|gopher|md5|hls):/i;
// A file-bearing filter OPTION token (curves=psfile=…, drawtext=textfile=…, movie=filename=…, …).
// Quotes are stripped before matching, so 'psfile'=… and "textfile"=… are caught too.
const FILE_OPTION =
  /(^|[\s,:;=])(psfile|filename|textfile|pfile|fontfile|model|model_filename|commands|file|stats_file)\s*=/i;
// A value that is itself an absolute path or a traversal.
const ABSOLUTE_OR_TRAVERSAL = /^\s*(\/|[a-zA-Z]:[\\/])|(^|[\\/])\.\.([\\/]|$)/;

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
function fontfileNeedsContainment(fontfile: string): boolean {
  return fontfile.includes('/') || fontfile.includes('\\') || fontfile.includes('..') || path.isAbsolute(fontfile);
}

function unsafeScalarValueReason(value: string): string | undefined {
  const unquoted = value.replace(/["'`]/g, '');

  if (unquoted.includes('://') || PSEUDO_PROTOCOL.test(unquoted)) {
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
// fontfile has its own realpath containment below.
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

    if (DANGEROUS_FILTERS.has(type.trim().toLowerCase())) {
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

function collectFontfiles(descriptor: TemplateDescriptor): string[] {
  const files: string[] = [];

  for (const node of objectNodes(descriptor)) {
    if (typeof node.fontfile === 'string') {
      files.push(node.fontfile);
    }
  }

  return files;
}

// Realpath-contain one path-like fontfile; returns an error message on escape, undefined when safe.
async function containFontfile(fontfile: string, mediaDir: string): Promise<string | undefined> {
  try {
    await assertWithinMediaDir(fontfile, mediaDir);

    return undefined;
  } catch (error) {
    return `fontfile ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Reject dangerous filter types + file/URL-bearing scalar values, and confirm every path-like
// fontfile stays under the media dir. Async because containment is realpath-checked (symlink-safe).
export async function assertDescriptorSafe(descriptor: TemplateDescriptor, mediaDir: string): Promise<GuardResult> {
  const escape = findFilterEscape(descriptor);

  if (escape) {
    return { ok: false, message: escape };
  }

  const pathLike = collectFontfiles(descriptor).filter(fontfileNeedsContainment);
  const checks = await Promise.all(pathLike.map((fontfile) => containFontfile(fontfile, mediaDir)));
  const failure = checks.find((message) => message !== undefined);

  if (failure) {
    return { ok: false, message: failure };
  }

  return { ok: true };
}
