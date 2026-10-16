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
// options. A colour of the engine grammar (#RRGGBB, #RGB, 0x…, a name, an @alpha suffix) only ever needs
// these characters.
const COLOR_TOKEN = /^[#A-Za-z0-9@._]+$/;

export function assertSafeColorToken(value: string, field: string): string {
  if (!COLOR_TOKEN.test(value)) {
    throw new Error(`Unsafe ${field}: "${value}" is not a colour (#RRGGBB, a name, an @alpha suffix)`);
  }

  return value;
}

// A section name is interpolated into output/asset file paths (`<buildDir>/<name>_output.mp4`, the
// concat list, staged segment files). Reject path separators, parent refs, and NUL so a malicious
// template's section name can't traverse out of the build/assets directory — other characters are
// fine since names are author-chosen identifiers. The Node `compile` entry schema-validates unless the
// caller passes `skipValidation` (e.g. `leclap verify --rerender`), so this runtime guard is the boundary
// on that path and the backstop on the others.
export function assertSafeSegmentName(name: string): string {
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes(NUL)) {
    throw new Error(`Unsafe section name "${name}": must not contain path separators, "..", or a NUL byte`);
  }

  return name;
}
