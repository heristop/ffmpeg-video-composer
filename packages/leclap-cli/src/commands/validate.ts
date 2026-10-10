import { defineCommand } from 'citty';
import fs from 'node:fs/promises';
import pc from 'picocolors';
import {
  TemplateValidator,
  geometryApproxNote,
  nodeGeometryWarnings,
  renderedGeometryWarnings,
  templateFontErrors,
  type GeometryWarning,
  type MotionWarning,
} from 'ffmpeg-video-composer';
import { setEngineLogLevel } from '../log.js';
import { resolveAssetsDir } from '../resolve-assets-dir.js';
import { collectRepeated, fontDirsFor } from '../render-args.js';
import { success, fail, step, hint } from '../ui.js';
import { wordmark } from '../theme.js';

// The validator returns this shape; kept local so the formatter is testable without importing engine
// internals. `path` points at the offending descriptor field.
interface ValidationError {
  path: string;
  message: string;
  code?: string;
  // How to fix it, when the validator knows: one sentence, a replacement value for `path`, and whether
  // that fix is mechanical (`format`) or a creative call (`judgement`). `--json` emits them unchanged.
  hint?: string;
  suggestion?: unknown;
  kind?: 'format' | 'judgement';
}

// The engine's type itself, not a hand-written mirror. A mirror that made `code`/`severity`/`approx`
// optional was strictly weaker than the original: renaming or dropping `approx` upstream would still
// type-check here and just silently stop printing the approximation marker — a confident pixel
// count for a number that was, in fact, guessed. `--json` emits the field unchanged.
type ValidationWarning = GeometryWarning;

// Present only with `--render`: what the rendered check measured, how long it took, and — when it
// could not render — why, so a report with no rendered findings never reads as a clean render.
interface RenderSummary {
  measured: number;
  seconds: number;
  unavailable?: string;
}

interface ValidationResult {
  success: boolean;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  // Advisory pacing findings from the motion timeline (and assertions it could not measure); like
  // geometry they never decide `success`.
  motionWarnings?: MotionWarning[];
  render?: RenderSummary;
}

// Schema errors arrive as `sections.1.caption`; geometry findings — and what an agent edits against —
// use `sections[1].caption`. One notation in one report.
export function bracketPath(path: string): string {
  return path.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// Pure: turn a validation result into display lines (no IO). On failure, one line per error plus a
// count; on success a single confirmation. Warnings are advisory — they render on both paths, never
// decide between them, and are counted in the headline so "valid" followed by yellow lines does not
// read as a contradiction. Each finding's message already names the section, so the path follows it
// dimmed rather than leading it a second time. picocolors honours NO_COLOR.
export function formatValidation(result: ValidationResult): string[] {
  return [...formatFindings(result), ...motionLines(result.motionWarnings), ...renderLines(result.render)];
}

// One line per motion finding, its hint dimmed beneath it: what a motion director would change.
function motionLines(warnings: MotionWarning[] | undefined): string[] {
  return (warnings ?? []).flatMap((w) => [
    step(`${pc.cyan('~')} ${w.message} ${pc.dim(`${w.path} ${w.code}`)}`),
    ...(w.hint ? [hint(`      ${w.hint}`)] : []),
  ]);
}

function renderLines(render: RenderSummary | undefined): string[] {
  if (!render) {
    return [];
  }

  if (render.unavailable) {
    return [hint(`  rendered check skipped — ${render.unavailable}`)];
  }

  return [
    hint(`  rendered check: ${plural(render.measured, 'text')} measured from pixels in ${render.seconds.toFixed(1)}s`),
  ];
}

function formatFindings(result: ValidationResult): string[] {
  const found = result.warnings ?? [];
  const warnings = found.map((w) => step(`${pc.yellow('!')} ${w.message}${geometryApproxNote(w)} ${pc.dim(w.path)}`));
  const count = found.length + (result.motionWarnings?.length ?? 0);
  const warned = count > 0 ? ` — ${plural(count, 'warning')}` : '';

  if (result.success) {
    return [success(`Template is valid${warned}`), ...warnings];
  }

  const errors = result.errors ?? [];

  if (errors.length === 0) {
    return [fail(`Template is invalid${warned}`), ...warnings];
  }

  const lines = errors.flatMap(errorLines);

  return [fail(`Template is invalid (${plural(errors.length, 'problem')})${warned}`), ...lines, ...warnings];
}

// One line per error, plus a dimmed `→ hint` line under it when the validator knows the fix.
function errorLines(error: ValidationError): string[] {
  const line = step(`${pc.red('✗')} ${pc.bold(bracketPath(error.path))} — ${error.message}`);

  return error.hint ? [line, hint(`      → ${error.hint}`)] : [line];
}

// The exit code is driven solely by `success`; geometry (and any other) warnings must never flip it,
// or `leclap validate` stops being usable as a CI gate.
export function exitCodeFor(result: ValidationResult): number {
  return result.success ? 0 : 1;
}

async function loadJson(templatePath: string): Promise<unknown> {
  const raw = await fs.readFile(templatePath, 'utf8');

  return JSON.parse(raw);
}

export const validate = defineCommand({
  meta: { name: 'validate', description: 'Validate a template JSON without rendering' },
  args: {
    template: { type: 'positional', description: 'Path to a template JSON file', required: true },
    json: { type: 'boolean', description: 'Emit a machine-readable JSON result', default: false },
    render: {
      type: 'boolean',
      description: 'Also render the sections with text and measure its contrast from pixels (needs FFmpeg; seconds)',
      default: false,
    },
    fonts: {
      type: 'string',
      description: "A directory global.fonts[].src may resolve in, after the template's own (repeatable)",
    },
  },
  async run({ args, rawArgs }) {
    const json = args.json;
    const fontDirs = fontDirsFor(process.cwd(), args.template, repeatedFonts(rawArgs));

    const result = await runValidation(args.template, json, args.render, fontDirs);

    const output = json ? `${JSON.stringify(result)}\n` : `${formatValidation(result).join('\n')}\n`;
    process.stdout.write(output);

    // `process.exitCode`, never `process.exit()`: writes to a pipe are asynchronous on POSIX, and
    // exiting outright discards whatever libuv has still queued. Piping `--json` into `jq` was
    // losing everything past the first pipe buffer — 64KB of a 600KB payload — which is exactly the
    // failing-template case that produces the most errors, and now also carries the warnings array.
    process.exitCode = exitCodeFor(result);
  },
});

// Every --fonts value; a programmatic run may pass no rawArgs.
function repeatedFonts(rawArgs: readonly string[] | undefined): string[] {
  return rawArgs ? collectRepeated(rawArgs, 'fonts') : [];
}

// Load + validate, mapping a missing file or JSON syntax error into a structured result (so both the
// human and --json paths render it uniformly). Prints the wordmark only in the human path.
async function runValidation(
  templatePath: string,
  json: boolean,
  render: boolean,
  fontDirs: string[] = []
): Promise<ValidationResult> {
  if (!json) process.stdout.write(wordmark());

  let data: unknown;

  try {
    data = await loadJson(templatePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!json) console.log(hint(`  ${templatePath}`));

    return { success: false, errors: [{ path: templatePath, message, code: 'load_error' }] };
  }

  const validator = new TemplateValidator();
  const result = await attachFontErrors(await attachGeometryWarnings(validator, data, render), data, fontDirs);

  return attachMotionWarnings(validator, data, result);
}

// The files global.fonts declares, opened where a `leclap render` of this template would read them (the
// template's directory, --fonts, then <cwd>/assets): a missing, unreadable or non-font file fails validation.
async function attachFontErrors(
  result: ValidationResult,
  data: unknown,
  fontDirs: string[]
): Promise<ValidationResult> {
  const errors = await templateFontErrors(data, { assetsDir: resolveAssetsDir(process.cwd()), fontDirs });

  return errors.length === 0 ? result : { ...result, success: false, errors: [...(result.errors ?? []), ...errors] };
}

// Render-free and synchronous; only for a parsed descriptor (a schema failure has nothing to time).
// Absent, not empty, when there is nothing to say — the same zero-token rule as geometry.
function attachMotionWarnings(validator: TemplateValidator, data: unknown, result: ValidationResult): ValidationResult {
  if (!result.success) {
    return result;
  }

  const motionWarnings = validator.getMotionWarnings(data);

  return motionWarnings.length > 0 ? { ...result, motionWarnings } : result;
}

type GeometryDescriptor = Parameters<typeof nodeGeometryWarnings>[0];

// `validateTemplate`'s `data` is a `TemplateDescriptor | Section` union (shared with `validateSection`);
// only the descriptor shape carries `sections`, so `'type' in descriptor` (a Section-only field) tells
// them apart. Geometry checks only make sense for a full descriptor, and only run when the descriptor
// parsed — schema failures without `data` skip straight through. Warnings are advisory: they attach
// alongside whatever `success`/`errors` the schema validator produced and never change them. The font
// loader tries the bundled fonts, then the catalog the renderer fetches from, and degrades to `null`
// per font (offline, unknown file) rather than throwing, so a miss falls back to approximate
// measurement instead of breaking validation.
async function attachGeometryWarnings(
  validator: TemplateValidator,
  data: unknown,
  render: boolean
): Promise<ValidationResult> {
  const result = validator.validateTemplate(data);
  const descriptor = result.data;

  if (!descriptor || 'type' in descriptor) {
    return result;
  }

  if (render && result.success) {
    return attachRenderedWarnings(result, data);
  }

  // The RAW descriptor, not `result.data`: `validateTemplate` expands `{ type: "partial", ref }`
  // sections inline before it returns, which shifts every later index — so a caption the author
  // wrote at `sections[1]` behind a three-section partial came back reported at `sections[3]`, and
  // an agent editing that path would touch the wrong section. `getGeometryWarnings` expands for
  // itself and maps the findings back to authored indices, so it needs the descriptor as written.
  const warnings = await nodeGeometryWarnings(data as GeometryDescriptor, { validator });

  // Absent, not empty: a clean template must not emit `"warnings":[]` — that is the zero-token
  // guarantee, and it only holds if the key itself disappears.
  if (warnings.length === 0) {
    return result;
  }

  // Passed through wholesale (code/severity/approx included): `--json` is documented to emit
  // whatever `getGeometryWarnings` returned, unreshaped.
  return { ...result, warnings };
}

// `--render`: the static findings refined by a real render of the sections with text, against the same
// `<cwd>/assets` a `leclap render` reads. The engine logs to stdout while it compiles, which would
// break `--json`, so it is silenced first. Advisory like the rest: `success` is left as it was.
async function attachRenderedWarnings(result: ValidationResult, data: unknown): Promise<ValidationResult> {
  setEngineLogLevel('silent');

  const started = performance.now();
  const rendered = await renderedGeometryWarnings(data as GeometryDescriptor, {
    assetsDir: resolveAssetsDir(process.cwd()),
  });
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  const render: RenderSummary = rendered.unavailable
    ? { measured: rendered.measured, seconds, unavailable: rendered.unavailable }
    : { measured: rendered.measured, seconds };

  return rendered.warnings.length > 0 ? { ...result, warnings: rendered.warnings, render } : { ...result, render };
}
