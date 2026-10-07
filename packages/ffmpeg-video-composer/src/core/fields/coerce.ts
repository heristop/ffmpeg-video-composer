import type { FieldType, TemplateField } from '../../schemas/fields.schemas';
import { FFMPEG_COLOR_NAMES } from './ffmpeg-color-names';

// One coercer per field type: raw input (a CLI string, an MCP number, a default) → the typed value that is
// substituted, or the reason it does not fit. A host can pass its own coercers per type to
// resolveFields (e.g. an HTML-escaping text coercer).

export type FieldValue = string | number;

export type Coerced = { ok: true; value: FieldValue } | { ok: false; reason: string };

export type FieldCoercer = (raw: unknown, field: TemplateField) => Coerced;

export type FieldCoercers = Partial<Record<FieldType, FieldCoercer>>;

// A decimal number only: Number() would also take 0x10, 0b11, 0o7 and Infinity.
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const CLOCK = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/;
// FFmpeg's colour grammar (libavutil/parseutils.c av_parse_color): `[#|0x]rrggbb[aa]` or a name, then an
// optional `@alpha`. Short hex and rgb()/rgba() are not FFmpeg's, so they are normalised to `#rrggbb[aa]`.
const FULL_HEX = /^(?:#|0x)?(?:[\da-f]{6}|[\da-f]{8})$/i;
const SHORT_HEX = /^#([\da-f]{3,4})$/i;
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/i;
const ALPHA = /^(?:0|1|0?\.\d+|1\.0*|0\.\d*)$/;
const URL_SCHEMES = new Set(['http', 'https', 'data', 'media']);
const SCHEME = /^([a-z][\da-z+.-]*):/i;

function fail(reason: string): Coerced {
  return { ok: false, reason };
}

function asText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;

  return typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : null;
}

function asNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  if (typeof raw !== 'string' || !DECIMAL.test(raw.trim())) return null;

  const parsed = Number(raw.trim());

  return Number.isFinite(parsed) ? parsed : null;
}

function inRange(value: number, field: TemplateField): Coerced {
  if (field.min !== undefined && value < field.min) return fail(`${value} is below the minimum ${field.min}`);

  if (field.max !== undefined && value > field.max) return fail(`${value} is above the maximum ${field.max}`);

  return { ok: true, value };
}

// `m:ss` or `h:mm:ss` (seconds, and minutes under hours, below 60), else plain decimal seconds.
function clockSeconds(text: string): number | null {
  const trimmed = text.trim();

  if (!CLOCK.test(trimmed)) return asNumber(trimmed);

  // [minutes, seconds] or [hours, minutes, seconds]: every part under an hour or a minute stays below 60.
  const parts = trimmed.split(':').map(Number);

  if (parts.slice(1).some((part) => part >= 60)) return null;

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function coerceText(raw: unknown, field: TemplateField): Coerced {
  const text = asText(raw);

  if (text === null) return fail('expected text');

  if (field.maxLength !== undefined && text.length > field.maxLength) {
    return fail(`${text.length} characters, more than maxLength ${field.maxLength}`);
  }

  return { ok: true, value: text };
}

function coerceNumber(raw: unknown, field: TemplateField): Coerced {
  const value = asNumber(raw);

  return value === null ? fail(`expected a number, got ${JSON.stringify(raw)}`) : inRange(value, field);
}

function coerceTime(raw: unknown, field: TemplateField): Coerced {
  const text = asText(raw);
  const seconds = text === null ? null : clockSeconds(text);

  if (seconds === null) return fail(`expected seconds or m:ss, got ${JSON.stringify(raw)}`);

  return seconds < 0 ? fail('a time cannot be negative') : inRange(seconds, field);
}

function hexByte(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0');
}

function isAlpha(text: string): boolean {
  return ALPHA.test(text) && Number(text) <= 1;
}

// `#rgb` / `#rgba` → `#rrggbb` / `#rrggbbaa`.
function expandShortHex(digits: string): string {
  return `#${digits.replace(/./g, (digit) => digit + digit)}`;
}

// `rgb(r, g, b)` / `rgba(r, g, b, a)`, channels 0–255 and alpha 0–1 → `#rrggbb[aa]`, or null.
function rgbFunctionHex(inner: string): string | null {
  const parts = inner.split(',').map((part) => part.trim());
  const channels = parts.slice(0, 3);
  const alpha = parts.length === 4 ? parts[3] : null;

  if (parts.length < 3 || parts.length > 4) return null;

  if (!channels.every((channel) => /^\d{1,3}$/.test(channel) && Number(channel) <= 255)) return null;

  if (alpha !== null && !isAlpha(alpha)) return null;

  const hex = `#${channels.map((channel) => hexByte(Number(channel))).join('')}`;

  return alpha === null ? hex : `${hex}${hexByte(Number(alpha) * 255)}`;
}

// The colour FFmpeg will parse, or null: functional and short forms normalised, an `@alpha` kept.
function ffmpegColor(text: string): string | null {
  const short = SHORT_HEX.exec(text);

  if (short) return expandShortHex(short[1]);

  const rgb = RGB_FUNCTION.exec(text);

  if (rgb) return rgbFunctionHex(rgb[1]);

  const [base, ...alphas] = text.split('@');

  if (alphas.length > 1 || (alphas.length === 1 && !isAlpha(alphas[0]))) return null;

  return FULL_HEX.test(base) || FFMPEG_COLOR_NAMES.has(base.toLowerCase()) ? text : null;
}

function coerceColor(raw: unknown): Coerced {
  const text = asText(raw)?.trim() ?? '';
  const color = ffmpegColor(text);

  return color === null
    ? fail(
        `expected a colour (#rrggbb[aa], #rgb, rgb(), 0xrrggbb or an FFmpeg colour name, then @alpha), got "${text}"`
      )
    : { ok: true, value: color };
}

// http(s), data and media:// URLs, or a relative path (no scheme, no whitespace).
function coerceUrl(raw: unknown): Coerced {
  const text = asText(raw)?.trim() ?? '';
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  const allowed = scheme === undefined ? text !== '' : URL_SCHEMES.has(scheme);

  if (!allowed || /\s/.test(text)) {
    return fail(`expected an http(s), data or media:// URL or a relative path, got "${text}"`);
  }

  return { ok: true, value: text };
}

function coerceMedia(raw: unknown): Coerced {
  const text = asText(raw)?.trim() ?? '';

  return text !== '' && !/[\n\r]/.test(text) ? { ok: true, value: text } : fail('expected a media path or URL');
}

function coerceEnum(raw: unknown, field: TemplateField): Coerced {
  const text = asText(raw);
  const options = field.options ?? [];

  if (text !== null && options.includes(text)) return { ok: true, value: text };

  return fail(`expected one of ${options.join(', ')}, got ${JSON.stringify(raw)}`);
}

export const DEFAULT_FIELD_COERCERS: Record<FieldType, FieldCoercer> = {
  text: coerceText,
  color: coerceColor,
  url: coerceUrl,
  media: coerceMedia,
  number: coerceNumber,
  enum: coerceEnum,
  time: coerceTime,
};

export function coerceFieldValue(field: TemplateField, raw: unknown, coercers: FieldCoercers = {}): Coerced {
  const coerce = coercers[field.type] ?? DEFAULT_FIELD_COERCERS[field.type];

  return coerce(raw, field);
}

// A stand-in of the right type for a field with no value, used when validating without values (probe mode),
// so the rest of the template can still be checked. Null when the field's own placeholder string will do.
export function probeValue(field: TemplateField): FieldValue | null {
  if (field.type === 'number' || field.type === 'time') return field.min ?? field.max ?? 1;

  if (field.type === 'color') return '#000000';

  if (field.type === 'enum') return field.options?.[0] ?? null;

  return null;
}
