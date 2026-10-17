// How WIDE a run of text renders, split out of text-boxes.ts to keep that file under the max-lines
// budget — the same split that produced text-appearance.ts. text-boxes.ts owns where text lands;
// this owns how much room it takes.
import { measureTextWidth, type FontMetrics } from '@/core/font-metrics';

// Without real metrics, assume every glyph is 0.5em — roughly the Latin average. It is not
// conservative in either direction (Rubik averages ~0.49em, Oswald ~0.37em), so an estimated box is
// a guess, not a bound. That is exactly why every finding drawn from one is flagged `approx`.
const ASSUMED_ADVANCE_EM = 0.5;

// drawtext starts a new line at each of these (vf_drawtext's `is_newline`), so `\r\n` makes two; its
// text_w is the widest line and its text_h grows with every one. No bundled font maps U+000A, so
// measuring the string as one run fell back to the estimate for the lines laid end to end.
const LINE_BREAK = /[\n\r\f\v]/;

// The section options that change the drawn string. `upperCase`/`lowerCase` live on the BASE section
// schema and are applied by FormatterManager.formatText to every text value in the section.
export interface TextCaseOptions {
  upperCase?: boolean;
  lowerCase?: boolean;
}

// `global.variables`: fixed by the descriptor itself, so — unlike a form field — known before render.
export type TextVariables = Record<string, unknown>;

// Why a width is an estimate: no metrics for the font, or a `{{ var }}` only filled at render time.
export type ApproxReason = 'font' | 'variable';

export interface Measurement {
  width: number;
  // How many lines drawtext stacks for the tallest locale; the box is that many lines high.
  lines: number;
  approx: boolean;
  approxReason?: ApproxReason;
}

// caption.text (and lowerThird.title/subtitle) is a TranslationSchema (locale map) for every
// schema-valid template. The bare-string branch stays for callers that hand collectBoxes unvalidated
// input directly. Blank strings are dropped here rather than at the call site so the trim matches
// the engine's own `hasText` (editor/presets/text.ts) — a whitespace-only caption draws nothing, so
// modelling a box for it invents findings about text that never appears.
function localeCandidates(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim() === '' ? [] : [value];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.values(value as Record<string, unknown>).filter(
    (v): v is string => typeof v === 'string' && v.trim() !== ''
  );
}

// Code points, the same unit `measureTextWidth` iterates and drawtext advances by. `text.length`
// counts UTF-16 units instead, which doubles an NFD accent and reads one ZWJ family emoji as eleven
// characters — so the estimate and the measurement would disagree about the very same string for
// reasons that have nothing to do with the typeface. Counted rather than `[...text].length` because
// the repo's `no-misused-spread` rule forbids spreading a string.
function codePointCount(text: string): number {
  let count = 0;

  for (const _codePoint of text) {
    count++;
  }

  return count;
}

// A `{{ var }}` left after `substituteVariables` is filled at render time (a form field, a runtime
// value). Measuring the placeholder itself made findings depend on the variable's NAME —
// `{{ form_1_product_name }}` reported a headline 250px off the frame that "Nova" would never reach.
// Only the literal text around it is measured: a lower bound, so whatever it finds holds for any
// value — still flagged approximate, since the real text can only be wider.
const PLACEHOLDER = /\{\{.*?\}\}/g;

function isTemplated(text: string): boolean {
  return text.includes('{{');
}

// The descriptor's own `global.variables` are substituted before anything is drawn
// (VariableManager.mapVariables: `{{ key }}` with one space each side, an array joined with ', '), so
// they are measured as the text they become. Measuring the placeholder instead reported a caption
// whose variable holds a 70-character headline as clean.
function substituteVariables(text: string, variables: TextVariables | undefined): string {
  if (!variables) {
    return text;
  }

  return text.replace(/\{\{ (.+?) \}\}/g, (placeholder: string, key: string) => {
    const value = Object.hasOwn(variables, key) ? variables[key] : undefined;
    const resolved = Array.isArray(value) ? value.join(', ') : value;

    return typeof resolved === 'string' || typeof resolved === 'number' ? String(resolved) : placeholder;
  });
}

// The string drawtext receives, built the way FormatterManager.formatText builds it: straight quotes
// become typographic ones (’ ”, wider in every bundled face but BebasNeue), then `upperCase` and
// `lowerCase` apply in THAT order — a section setting both draws lowercase. Uppercase Latin runs ~20%
// wider, so measuring the authored string instead of the drawn one is not a rounding error.
function asDrawn(text: string, options: TextCaseOptions | undefined): string {
  const typographic = text.replace(/'/g, '’').replace(/"/g, '”');
  const upper = options?.upperCase ? typographic.toUpperCase() : typographic;

  return options?.lowerCase ? upper.toLowerCase() : upper;
}

function measureLine(
  line: string,
  fontSize: number,
  metrics: FontMetrics | null
): { width: number; approxReason?: ApproxReason } {
  const templated = isTemplated(line);
  const literal = templated ? line.replace(PLACEHOLDER, '') : line;
  const exact = metrics ? measureTextWidth(metrics, literal, fontSize) : null;
  let approxReason: ApproxReason | undefined;

  if (templated || exact === null) approxReason = exact === null ? 'font' : 'variable';

  return { width: exact ?? codePointCount(literal) * ASSUMED_ADVANCE_EM * fontSize, approxReason };
}

// The widest line of the widest locale wins, measured rather than counted: 24 "W"s render three times
// wider than 26 "l"s, so picking the locale with the most UTF-16 code units drops real overflows and
// invents fake ones. Every locale is a candidate because any of them may be the one that ships.
export function measure(
  value: unknown,
  fontSize: number,
  metrics: FontMetrics | null,
  options?: TextCaseOptions,
  variables?: TextVariables
): Measurement | null {
  const candidates = localeCandidates(value);

  if (candidates.length === 0) {
    return null;
  }

  let width = 0;
  let lines = 1;
  let approxReason: ApproxReason | undefined;

  for (const authored of candidates) {
    const drawn = asDrawn(substituteVariables(authored, variables), options).split(LINE_BREAK);

    lines = Math.max(lines, drawn.length);

    for (const line of drawn) {
      const result = measureLine(line, fontSize, metrics);
      width = Math.max(width, result.width);
      approxReason ??= result.approxReason;
    }
  }

  return { width, lines, approx: approxReason !== undefined, approxReason };
}
