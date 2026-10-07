// D4 — raw-filter hygiene. Raw `filters[]` are passed through to FFmpeg verbatim, so they are the one
// place a template can smuggle in a value that differs from run to run. This scan finds the FFmpeg
// constructs that read the wall clock or an unseeded random stream, wherever a filter lives in the
// descriptor (section chains, map chains, input chains, partials).

export interface NondeterministicFinding {
  /** Dotted/indexed path to the offending string, e.g. `sections[2].filters[0].values.text.en`. */
  path: string;
  /** The construct that was matched, e.g. `%{localtime`. */
  token: string;
}

// Each pattern reads state outside (template, seed, frame):
// - `%{localtime}` / `%{gmtime}` drawtext expansions print the wall-clock date;
// - `time(0)` is the expression evaluator's wall-clock function;
// - `random(n)` draws from an evaluator stream seeded per filter instance, so its values shift whenever
//   the number or order of evaluations changes (threading, frame drops). Use `global.seed` presets.
const PATTERNS: ReadonlyArray<{ token: string; regex: RegExp }> = [
  { token: '%{localtime', regex: /%\{\s*localtime/i },
  { token: '%{gmtime', regex: /%\{\s*gmtime/i },
  { token: 'time(', regex: /(?<![a-z_])time\s*\(/i },
  { token: 'random(', regex: /(?<![a-z_])random\s*\(/i },
];

function scanString(value: string, path: string, findings: NondeterministicFinding[]): void {
  for (const { token, regex } of PATTERNS) {
    if (regex.test(value)) findings.push({ path, token });
  }
}

function isFilterLike(value: Record<string, unknown>): boolean {
  return typeof value.type === 'string' && ('value' in value || 'values' in value);
}

// Walks the descriptor, scanning every string under a filter-shaped object. Text outside filters
// (meta, translations of captions, URLs) never reaches the expression evaluator and is ignored.
function walk(value: unknown, path: string, inFilter: boolean, findings: NondeterministicFinding[]): void {
  if (typeof value === 'string') {
    if (inFilter) scanString(value, path, findings);

    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) walk(item, `${path}[${index}]`, inFilter, findings);

    return;
  }

  if (value === null || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const filter = inFilter || isFilterLike(record);

  for (const [key, child] of Object.entries(record)) {
    walk(child, path ? `${path}.${key}` : key, filter, findings);
  }
}

/** Every wall-clock or unseeded-random construct in the descriptor's raw filters. */
export function findNondeterministicExpressions(descriptor: unknown): NondeterministicFinding[] {
  const findings: NondeterministicFinding[] = [];
  walk(descriptor, '', false, findings);

  return findings;
}
