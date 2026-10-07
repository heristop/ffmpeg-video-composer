// Media a template link cannot carry: references only the author's machine (or browser) can read. A link
// travels as text, so a clip at /Users/me/take.mp4 or an upload keyed media://abc in another browser's
// store reaches the builder as a dangling path. These are listed so the agent can say so and the builder
// can turn them into empty slots the user fills again. Library names, served /assets/ paths, http(s)
// and data: URLs and {{ variables }} resolve wherever the template opens. Any other URL scheme
// (javascript:, ftp:, …) is not something the builder loads, so it is listed and dropped the same way.

export type MediaRebindReason = 'local_path' | 'browser_blob' | 'device_upload' | 'unsupported_scheme';

export interface MediaToRebind {
  /** RFC 6901 JSON Pointer to the field. */
  pointer: string;
  value: string;
  reason: MediaRebindReason;
}

// The descriptor fields that hold a media path or URL (sections, inputs, global music/watermark/animations,
// LUTs, cutaways, drawtext fonts). Effect `assets` values are media too, whatever their key.
const MEDIA_KEYS = new Set(['url', 'videoUrl', 'pictureUrl', 'logoUrl', 'backgroundUrl', 'fontfile']);
// `font` (kinetic text, ticker/chart graphics, overlays) takes a bundled font id or a font file; only a
// value that names a file is media.
const FONT_KEY = 'font';
const FONT_FILE = /[\\/]|\.(?:ttf|otf|woff2?)$/i;
// Absolute paths the web app serves itself (public/ and the staged creative-kit library).
const SERVED_ROOTS = ['/assets/', '/musics/', '/backgrounds/', '/fonts/', '/videos/', '/images/'];
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const WINDOWS_PATH = /^[a-z]:[\\/]/i;
const RELATIVE_UP = /^\.{1,2}[\\/]/;
// Schemes that resolve wherever the link opens (`library://` is the bundled-library marker).
const READABLE_SCHEMES = new Set(['http', 'https', 'data', 'library']);
const SCHEME_REASONS: Record<string, MediaRebindReason> = {
  media: 'device_upload',
  blob: 'browser_blob',
  file: 'local_path',
};

function schemeReason(scheme: string): MediaRebindReason | null {
  if (READABLE_SCHEMES.has(scheme)) return null;

  return SCHEME_REASONS[scheme] ?? 'unsupported_scheme';
}

/** Why `value` cannot resolve where the link opens, or null when it can. */
export function classifyMediaRef(raw: string): MediaRebindReason | null {
  const value = raw.trim();

  if (value === '') return null;

  if (WINDOWS_PATH.test(value) || value.startsWith(String.raw`\\`)) return 'local_path';

  const scheme = SCHEME.exec(value)?.[1].toLowerCase();

  if (scheme) return schemeReason(scheme);

  if (value.startsWith('~') || RELATIVE_UP.test(value)) return 'local_path';

  if (!value.startsWith('/')) return null;

  return SERVED_ROOTS.some((root) => value.startsWith(root)) ? null : 'local_path';
}

function escapeSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function isMediaField(key: string, value: string): boolean {
  if (key === FONT_KEY) return FONT_FILE.test(value.trim());

  return MEDIA_KEYS.has(key);
}

function visit(node: unknown, pointer: string, inAssets: boolean, out: MediaToRebind[]): void {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) visit(item, `${pointer}/${String(index)}`, false, out);

    return;
  }

  if (!node || typeof node !== 'object') return;

  for (const [key, child] of Object.entries(node)) {
    const at = `${pointer}/${escapeSegment(key)}`;

    if (typeof child !== 'string') {
      visit(child, at, key === 'assets', out);
      continue;
    }

    const reason = inAssets || isMediaField(key, child) ? classifyMediaRef(child) : null;

    if (reason) out.push({ pointer: at, value: child, reason });
  }
}

/** Every media field of `template` that must be re-bound after opening it from a link, in document order. */
export function mediaToRebind(template: unknown): MediaToRebind[] {
  const out: MediaToRebind[] = [];
  visit(template, '', false, out);

  return out;
}
