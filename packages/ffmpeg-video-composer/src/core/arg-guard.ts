import { expressionPattern } from '../schemas/filter-expression.schemas';
import { SECTION_NAME } from '../schemas/section-name.schemas';

// Guard for template-derived values that are interpolated UNQUOTED into the FFmpeg command string.
// The command is built as a string and then space-split by `parseCommand` into an argv array for
// `execFile`. Positional values such as a `color=c=<color>` source, a `-i <path/url>` input, or a
// section name are single argv tokens *by construction*: the only way an attacker can inject extra
// ffmpeg arguments (e.g. a second `-i`, a `-map`, or an alternate output file) is to smuggle ASCII
// whitespace into the resolved value so `parseCommand` starts a new token.
//
// Rejecting raw whitespace (and NUL) is therefore safe and high-confidence: a legitimate color
// (`red`, `#000000`, `red@0.5`), file path, section name, or URL in this pipeline never contains raw
// whitespace — real URLs percent-encode spaces. Shell injection is already prevented by execFile;
// this closes the remaining argv-level hole. Quoted filter values (`-vf "..."` / `-filter_complex
// "..."`) are single tokens already and are intentionally NOT guarded here.
// `\s` matches ASCII space/tab/CR/LF/FF/VT (and Unicode whitespace). NUL is not whitespace, so it is
// checked separately rather than embedding a control character in the regex.
const WHITESPACE = /\s/;
const NUL = String.fromCodePoint(0);

export function assertSafeArgToken(value: string, field: string): string {
  if (WHITESPACE.test(value) || value.includes(NUL)) {
    throw new Error(`Unsafe ${field}: value contains whitespace or a NUL byte and would inject extra ffmpeg arguments`);
  }

  return value;
}

// A colour interpolated unquoted into a `color=c=<colour>` lavfi source sits INSIDE an input filtergraph,
// so whitespace is not the only escape: `,` `;` `[` `]` `=` `:` `/` and quotes chain further filters or
// options, and a quote closes a quoted `fontcolor='…'`. A colour of the engine grammar (#RRGGBB, #RGB,
// 0x…, a name, an @alpha suffix, a theme token) only ever needs these characters.
const COLOR_TOKEN = /^[#$A-Za-z0-9@._]+$/;

export function assertSafeColorToken(value: string, field: string): string {
  if (!COLOR_TOKEN.test(value)) {
    throw new Error(`Unsafe ${field}: "${value}" is not a colour (#RRGGBB, a name, an @alpha suffix)`);
  }

  return value;
}

// A section name is interpolated into output/asset file paths (`<buildDir>/<name>_output.mp4`, the
// concat list, staged segment files) written unquoted into the command string, and into pad labels. The
// schema grammar (schemas/section-name.schemas.ts) leaves out separators, `..`, whitespace, quotes and
// filtergraph syntax, so a name can neither traverse out of the build dir, add an argument nor splice a
// graph. The Node `compile` entry schema-validates unless the caller passes `skipValidation` (e.g.
// `leclap verify --rerender`), so this runtime guard is the boundary on that path and the backstop on
// the others.
export function assertSafeSegmentName(name: string): string {
  if (!SECTION_NAME.test(name)) {
    throw new Error(
      `Unsafe section name "${name}": use letters, digits, "_", "-" and "." only (no "..", at least one letter or digit)`
    );
  }

  return name;
}

// An expression-typed field (an overlay position or scale, a crop rectangle) that the engine splices into a
// filtergraph unquoted: the schema grammar (schemas/filter-expression.schemas.ts), checked again where it is
// interpolated so a descriptor that skipped validation cannot chain filters through it.
export function assertSafeExpression(value: string | number, field: string, parts = 1): string {
  const text = String(value);

  if (!expressionPattern(parts).test(text)) {
    throw new Error(`Unsafe ${field}: "${text}" is not an FFmpeg expression of ${parts} ":"-separated part(s)`);
  }

  return text;
}

// A number the schema guarantees, written into a filter as text: a caller that skipped validation could
// hand any JSON value, so it is coerced and must be finite.
export function assertFiniteNumber(value: unknown, field: string): number {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;

  if (!Number.isFinite(number)) throw new Error(`Unsafe ${field}: ${JSON.stringify(value)} is not a number`);

  return number;
}
