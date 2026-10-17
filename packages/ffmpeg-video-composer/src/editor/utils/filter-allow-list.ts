// The raw `filters` a template may author, by default. A template is untrusted input (an agent, a shared
// link, a downloaded file), and raw FFmpeg filters were a deny-list game: positional options reach file
// options with no key (metadata's 6th writes a file, psnr's 1st, curves' 7th reads one), so every round
// of deny-listing found another one. Authored filters are checked here against an allow-list instead:
// a known file-free type, its option names, and at most the positional options the table lists (each
// a file-free option in FFmpeg's own order). It runs twice: on the authored descriptor at validation
// (agent-facing issues), and on the fully resolved descriptor right before lowering (formats, partial
// variables, fields and theme tokens substituted; director/prepare-build.ts), which is the gate that
// holds. Engine presets never pass through here: sugar is expanded into filters after both checks.
// `allowRawFilters` (trusted local authors) skips it; the render-time deny-list (filter-option-guard.ts)
// stays on in both modes.

import { nearest } from '../../services/validation/suggest';
import type { ValidationError } from '../../services/validation/types';
import { assertBareFontFile, filterValueProblem, readToken } from './filter-option-guard';
import { engineOnlyFilterIssues } from './engine-only-filters';

export interface FilterRule {
  /** Option names accepted as `key=value` (in `values` or the scalar `value`). */
  keys: readonly string[];
  /** File-free options FFmpeg reads positionally, in its order: the count is the positional limit. */
  positional?: readonly string[];
}

const FADE: FilterRule = {
  keys: ['type', 't', 'start_frame', 's', 'nb_frames', 'n', 'start_time', 'st', 'duration', 'd', 'alpha', 'color', 'c'],
  positional: ['type', 'start_frame', 'nb_frames', 'start_time', 'duration'],
};

/** Authored filter types safe for untrusted templates, with the options each may take. */
export const AUTHORED_FILTERS: Readonly<Record<string, FilterRule>> = {
  // Text and boxes (no textfile; fontfile is a bare staged font name).
  drawtext: {
    keys: [
      'text',
      'x',
      'y',
      'fontsize',
      'fontcolor',
      'fontcolor_expr',
      'fontfile',
      'alpha',
      'box',
      'boxcolor',
      'boxborderw',
      'boxw',
      'boxh',
      'borderw',
      'bordercolor',
      'shadowcolor',
      'shadowx',
      'shadowy',
      'line_spacing',
      'text_align',
      'y_align',
      'fix_bounds',
      'tabsize',
      'text_shaping',
    ],
  },
  drawbox: {
    keys: ['x', 'y', 'w', 'h', 'width', 'height', 'c', 'color', 't', 'thickness', 'replace'],
    positional: ['x', 'y', 'width', 'height', 'color', 'thickness'],
  },
  // Time.
  fade: FADE,
  fadein: FADE,
  fadeout: FADE,
  setpts: { keys: ['expr'], positional: ['expr'] },
  fps: { keys: ['fps', 'start_time', 'round', 'eof_action'], positional: ['fps', 'start_time', 'round', 'eof_action'] },
  // Geometry.
  scale: {
    keys: ['w', 'h', 'width', 'height', 'flags', 'force_original_aspect_ratio', 'force_divisible_by', 'interl', 'eval'],
    positional: ['w', 'h', 'flags'],
  },
  crop: {
    keys: ['w', 'h', 'out_w', 'out_h', 'x', 'y', 'keep_aspect', 'exact'],
    positional: ['w', 'h', 'x', 'y', 'keep_aspect', 'exact'],
  },
  pad: {
    keys: ['w', 'h', 'width', 'height', 'x', 'y', 'color', 'eval', 'aspect'],
    positional: ['width', 'height', 'x', 'y', 'color'],
  },
  overlay: {
    keys: ['x', 'y', 'eof_action', 'eval', 'shortest', 'format', 'repeatlast', 'alpha'],
    positional: ['x', 'y'],
  },
  perspective: {
    keys: ['x0', 'y0', 'x1', 'y1', 'x2', 'y2', 'x3', 'y3', 'interpolation', 'sense', 'eval'],
    positional: ['x0', 'y0', 'x1', 'y1', 'x2', 'y2', 'x3', 'y3', 'interpolation', 'sense', 'eval'],
  },
  rotate: {
    keys: ['angle', 'a', 'out_w', 'ow', 'out_h', 'oh', 'bilinear', 'fillcolor', 'c'],
    positional: ['angle', 'out_w', 'out_h', 'fillcolor', 'bilinear'],
  },
  transpose: { keys: ['dir', 'passthrough'], positional: ['dir', 'passthrough'] },
  hflip: { keys: [] },
  vflip: { keys: [] },
  setsar: { keys: ['sar', 'r', 'ratio', 'max'], positional: ['sar', 'max'] },
  setdar: { keys: ['dar', 'r', 'ratio', 'max'], positional: ['dar', 'max'] },
  // Colour and blur.
  vignette: {
    keys: ['angle', 'a', 'x0', 'y0', 'mode', 'eval', 'dither', 'aspect'],
    positional: ['angle', 'x0', 'y0'],
  },
  boxblur: {
    keys: [
      'luma_radius',
      'lr',
      'luma_power',
      'lp',
      'chroma_radius',
      'cr',
      'chroma_power',
      'cp',
      'alpha_radius',
      'ar',
      'alpha_power',
      'ap',
    ],
    positional: ['luma_radius', 'luma_power', 'chroma_radius', 'chroma_power', 'alpha_radius', 'alpha_power'],
  },
  gblur: { keys: ['sigma', 'steps', 'planes', 'sigmaV'], positional: ['sigma', 'steps', 'planes', 'sigmaV'] },
  hue: { keys: ['h', 's', 'H', 'b'], positional: ['h', 's'] },
  eq: {
    keys: ['contrast', 'brightness', 'saturation', 'gamma', 'gamma_r', 'gamma_g', 'gamma_b', 'gamma_weight', 'eval'],
    positional: ['contrast', 'brightness', 'saturation', 'gamma', 'gamma_r', 'gamma_g', 'gamma_b', 'gamma_weight'],
  },
  colorchannelmixer: {
    keys: ['rr', 'rg', 'rb', 'ra', 'gr', 'gg', 'gb', 'ga', 'br', 'bg', 'bb', 'ba', 'ar', 'ag', 'ab', 'aa', 'pc', 'pa'],
    positional: ['rr', 'rg', 'rb', 'ra', 'gr', 'gg', 'gb', 'ga', 'br', 'bg', 'bb', 'ba', 'ar', 'ag', 'ab', 'aa'],
  },
  colorbalance: {
    keys: ['rs', 'gs', 'bs', 'rm', 'gm', 'bm', 'rh', 'gh', 'bh', 'pl'],
    positional: ['rs', 'gs', 'bs', 'rm', 'gm', 'bm', 'rh', 'gh', 'bh', 'pl'],
  },
  lutyuv: { keys: ['y', 'u', 'v', 'a', 'c0', 'c1', 'c2', 'c3'] },
  lutrgb: { keys: ['r', 'g', 'b', 'a', 'c0', 'c1', 'c2', 'c3'] },
  // A curves preset only: the 7th positional and `psfile` read a file.
  curves: { keys: ['preset', 'interp'], positional: ['preset'] },
  negate: { keys: [] },
  format: { keys: ['pix_fmts'], positional: ['pix_fmts'] },
  null: { keys: [] },
  // A LUT look: the value names a preset the engine stages (FormatterManager.formatLut3d), never a file.
  lut3d: { keys: [] },
  // Audio.
  volume: { keys: ['volume', 'precision', 'eval'], positional: ['volume'] },
  afade: {
    keys: ['type', 't', 'start_sample', 'ss', 'nb_samples', 'ns', 'start_time', 'st', 'duration', 'd', 'curve', 'c'],
    positional: ['type', 'start_sample', 'nb_samples'],
  },
  atempo: { keys: ['tempo'], positional: ['tempo'] },
};

/** A timeline option every filter that supports it takes; it holds an expression, never a file. */
const COMMON_KEYS = new Set(['enable']);

/** A map pad label: a stream (`0:v`), an `@input` reference or a plain label. */
const PAD_LABEL = /^(?:@?[a-z0-9_]+|\d+:[av])$/;

/** A LUT look value: a bare preset name with an optional `@strength`. `url:` LUTs need allowRawFilters. */
const LUT_PRESET = /^[A-Za-z0-9_-]+(?:@[0-9.]+)?$/;

type Issue = ValidationError;

function issue(path: string, message: string, hint: string, suggestion?: string): Issue {
  return {
    path,
    message,
    code: 'filter_not_allowed',
    hint,
    ...(suggestion === undefined ? {} : { suggestion }),
  };
}

const OPT_IN = 'Use an allow-listed filter, or render with allowRawFilters (trusted local templates only).';

function allowedKey(rule: FilterRule, key: string): boolean {
  return rule.keys.includes(key) || COMMON_KEYS.has(key);
}

function fontProblem(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  try {
    assertBareFontFile(value);

    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// One `:`-separated option of a scalar value, against the rule: a named option must be allowed, and a
// positional one must fit the rule's positional slots and come before any named option.
function optionProblem(
  text: string,
  rule: FilterRule,
  state: { positional: number; named: boolean }
): string | undefined {
  const equals = text.indexOf('=');

  if (equals >= 0) {
    const key = text.slice(0, equals).trim();
    state.named = true;

    if (!allowedKey(rule, key)) return `has no allowed option "${key}"`;

    return key === 'fontfile' ? fontProblem(text.slice(equals + 1)) : undefined;
  }

  const limit = rule.positional?.length ?? 0;

  if (state.named || state.positional >= limit) return `takes at most ${limit} positional option(s)`;

  state.positional++;

  return undefined;
}

// Why a scalar `value` falls outside its rule: a chained filter, an open quote or escape, an unknown
// option name, or more positional options than the rule lists.
function optionsProblem(value: string, rule: FilterRule): string | undefined {
  const graph = readToken(value, '[];,');

  if (graph.open || graph.rest) return 'chains another filter or leaves its option open';

  const state = { positional: 0, named: false };
  let rest = graph.value;

  while (rest.length > 0) {
    const option = readToken(rest, ':');
    const problem = option.open ? 'leaves a quote or an escape open' : optionProblem(option.value, rule, state);

    if (problem) return problem;

    rest = option.rest.slice(1);
  }

  return undefined;
}

function valueProblem(type: string, value: string, rule: FilterRule): string | undefined {
  if (type === 'lut3d') return LUT_PRESET.test(value) ? undefined : 'a LUT look takes a bare preset name';

  if (type === 'scale' && value === 'output') return undefined;

  return optionsProblem(value, rule);
}

function valuesProblem(type: string, values: Record<string, unknown>, rule: FilterRule): string | undefined {
  if (type === 'lut3d') return 'a LUT look is a scalar preset name';

  for (const [key, value] of Object.entries(values)) {
    if (!allowedKey(rule, key)) return `has no allowed option "${key}"`;

    const font = key === 'fontfile' ? fontProblem(value) : undefined;

    if (font) return font;

    // The rest reach FFmpeg as `key=value` (FormatterManager.formatDefaultValue): the render-time guard,
    // reported here. drawtext text is escaped on its own path.
    const text = key === 'text' || key === 'fontfile' ? undefined : scalar(value);
    const raw = text === undefined ? null : filterValueProblem(key, text);

    if (raw) return `has an unsafe option ${raw}`;
  }

  return undefined;
}

function unknownFilter(type: string, path: string): Issue {
  const suggestion = nearest(type, Object.keys(AUTHORED_FILTERS));
  const hint = suggestion === undefined ? OPT_IN : `Use "${suggestion}" instead, or render with allowRawFilters.`;

  return issue(
    path,
    `Filter "${type}" is not allowed in a template: it is not on the raw filter allow-list.`,
    hint,
    suggestion
  );
}

function scalar(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

// A `$format` object, a `{{ placeholder }}` or any non-scalar where FFmpeg reads raw text: it would be
// substituted after the authored descriptor is read, so it is refused where a template is validated.
function markerProblem(filter: Record<string, unknown>): string | undefined {
  if (typeof filter.type !== 'string') return 'type must be a plain filter name, not an object or a placeholder';

  if (filter.value !== undefined && scalar(filter.value) === undefined) {
    return 'value must be a plain string or number, not an object or a $format block';
  }

  if (`${filter.type} ${scalar(filter.value) ?? ''}`.includes('{{')) {
    return 'type and value cannot hold a {{ placeholder }}: write the filter text itself';
  }

  const values = Object.entries(record(filter.values) ?? {});
  const formatted = values.find(([, value]) => record(value)?.$format !== undefined);

  return formatted ? `values.${formatted[0]} cannot be a $format block` : undefined;
}

function filterIssue(filter: Record<string, unknown>, path: string): Issue | undefined {
  const marker = markerProblem(filter);

  if (marker) return issue(path, `Filter ${marker}.`, OPT_IN);

  const type = filter.type as string;
  const rule = Object.hasOwn(AUTHORED_FILTERS, type) ? AUTHORED_FILTERS[type] : undefined;

  if (!rule) return unknownFilter(type, path);

  if (filter.graph !== undefined) {
    return issue(path, `Filter "${type}" carries a graph block, which only the engine emits.`, OPT_IN);
  }

  const value = scalar(filter.value);
  const values = record(filter.values);
  const problem =
    (value === undefined ? undefined : valueProblem(type, value, rule)) ??
    (values === undefined ? undefined : valuesProblem(type, values, rule));

  if (problem === undefined) return undefined;

  const allowed = rule.keys.length > 0 ? rule.keys.join(', ') : '(none)';

  return issue(path, `Filter "${type}" ${problem}.`, `Allowed options: ${allowed}. ${OPT_IN}`);
}

function mapIssues(map: Record<string, unknown>, path: string): Issue[] {
  const labels = (['inputs', 'outputs'] as const).flatMap((side) =>
    (Array.isArray(map[side]) ? (map[side] as unknown[]) : []).map((label, index) => ({
      label,
      at: `${path}.${side}[${index}]`,
    }))
  );

  return labels
    .filter(({ label }) => typeof label !== 'string' || !PAD_LABEL.test(label))
    .map(({ label, at }) =>
      issue(
        at,
        `Map label "${String(label)}" is not a pad label.`,
        'Use a stream such as "0:v", an "@input" or a plain lower-case label.'
      )
    );
}

// The issues of one array element: a raw filter under `filters`, the pad labels of a map under `maps`.
function elementIssues(child: unknown, key: string, at: string): Issue[] {
  const element = record(child);

  if (!element) return [];

  if (key === 'maps') return mapIssues(element, at);

  if (key !== 'filters' || element.type === undefined) return [];

  const found = filterIssue(element, at);

  return found ? [found] : [];
}

/**
 * Every authored raw filter (sections, inputs, maps, inline partials: any `filters` array of the
 * descriptor) and map pad label outside the allow-list, as `filter_not_allowed` validation issues.
 */
export function authoredFilterIssues(descriptor: unknown): Issue[] {
  const issues: Issue[] = [];

  (function walk(node: unknown, path: string, key: string): void {
    if (Array.isArray(node)) {
      for (const [index, child] of node.entries()) {
        const at = `${path}[${index}]`;

        issues.push(...elementIssues(child, key, at));
        walk(child, at, '');
      }

      return;
    }

    const object = record(node);

    for (const [childKey, child] of Object.entries(object ?? {})) {
      walk(child, path ? `${path}.${childKey}` : childKey, childKey);
    }
  })(descriptor, '', '');

  return issues;
}

/**
 * The render-path gate, on the fully resolved descriptor right before lowering: throws the first refused
 * filters (engine-internal options in every mode, the allow-list unless the caller trusts the template).
 */
export function assertRawFiltersAllowed(descriptor: unknown, allowRawFilters: boolean | undefined): void {
  const issues = [...engineOnlyFilterIssues(descriptor), ...(allowRawFilters ? [] : authoredFilterIssues(descriptor))];

  if (issues.length === 0) return;

  const lines = issues.slice(0, 3).map((found) => `${found.path}: ${found.message}`);

  throw new Error(`filter_not_allowed: ${lines.join('; ')} ${OPT_IN}`);
}
