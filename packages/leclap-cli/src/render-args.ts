import path from 'node:path';
import { OrientationSchema, type ProjectConfig, type TemplateDescriptor } from 'ffmpeg-video-composer';
import { parseFormatFlag } from './render-formats.js';

// Pure assembly of a render's ProjectConfig from CLI flags — kept out of the command so it is unit
// testable without touching the filesystem or the engine.

export interface RenderFlags {
  /** Repeatable `--field key=value`, merged into `fields` (template variables / form values). */
  field?: string[];
  /** Repeatable `--set name=value`: a value for a declared `global.fields` entry (wins over `--field`). */
  set?: string[];
  /** Repeatable `--video section=path`, merged into `userVideoPaths` (paths resolved vs cwd). */
  video?: string[];
  /** `--locale` → `currentLocale`. */
  locale?: string;
  /** `--orientation` → overrides `descriptor.global.orientation` (see withOrientation). */
  orientation?: string;
  /** `--format` → `ProjectConfig.format`: the template's composition for that format (its `formats` override). */
  format?: string;
  /** `--assets` dir override (resolved vs cwd; defaults to `<cwd>/assets`). */
  assets?: string;
  /** `--build` dir override (resolved vs cwd; defaults to `<cwd>/build`). */
  build?: string;
  /** `--deterministic` (default on): bit-exact muxing and pinned encoder threads (engine D5 profile). */
  deterministic?: boolean;
  /** `--qc`: probe and decode the finished video, report findings, exit non-zero on a failure. */
  qc?: boolean;
  /** `--cache <dir>`: per-section render cache (resolved vs cwd). */
  cache?: string;
  /** Repeatable `--fonts <dir>`: directories `global.fonts[].src` may resolve in, after the template's own. */
  fonts?: string[];
}

/**
 * Where a template's `global.fonts[].src` paths resolve (ProjectConfig.fontDirs): the template's own
 * directory first, so a src is relative to the template file, then each `--fonts` dir (resolved vs cwd).
 * The engine reads nothing outside these and the assets dir.
 */
export function fontDirsFor(cwd: string, templatePath: string | undefined, fonts: readonly string[] = []): string[] {
  const dirs = [
    ...(templatePath ? [path.dirname(path.resolve(cwd, templatePath))] : []),
    ...fonts.map((dir) => path.resolve(cwd, dir)),
  ];

  return [...new Set(dirs)];
}

// Every value of a repeatable flag, read from raw argv in order. citty parses a repeated string flag
// as last-wins, so `--field a=1 --field b=2` reached the engine as `b=2` alone (and a two-clip
// template could only ever map one --video). Accepts `--name value` and `--name=value`.
export function collectRepeated(rawArgs: readonly string[], name: string): string[] {
  const flag = `--${name}`;
  const values: string[] = [];

  for (const [index, arg] of rawArgs.entries()) {
    if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));

      continue;
    }

    const next = index + 1 < rawArgs.length ? rawArgs[index + 1] : undefined;

    if (arg === flag && next !== undefined && !next.startsWith('--')) values.push(next);
  }

  return values;
}

// Parse repeatable `key=value` flag values into a record. Splits on the FIRST `=` so values may
// contain `=` (e.g. a URL query). `label` is the flag name, used in the error message.
export function parseKeyValues(pairs: string[] | undefined, label: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const pair of pairs ?? []) {
    const eq = pair.indexOf('=');

    if (eq === -1) {
      throw new Error(`--${label} expects key=value, got "${pair}"`);
    }

    const key = pair.slice(0, eq).trim();

    if (!key) {
      throw new Error(`--${label} expects key=value, got "${pair}"`);
    }

    out[key] = pair.slice(eq + 1).trim();
  }

  return out;
}

// Assemble the ProjectConfig for a render. buildDir/assetsDir default to cwd-relative dirs; the rest of
// the config is only set when the matching flag was passed, so unset flags leave engine defaults intact.
export function buildProjectConfig(
  cwd: string,
  flags: RenderFlags,
  templatePath?: string
): ProjectConfig & { buildDir: string } {
  const buildDir = flags.build ? path.resolve(cwd, flags.build) : path.resolve(cwd, 'build');
  const assetsDir = flags.assets ? path.resolve(cwd, flags.assets) : path.resolve(cwd, 'assets');

  const config: ProjectConfig & { buildDir: string } = {
    buildDir,
    assetsDir,
    fields: { ...parseKeyValues(flags.field, 'field'), ...parseKeyValues(flags.set, 'set') },
  };
  const fontDirs = fontDirsFor(cwd, templatePath, flags.fonts);

  if (fontDirs.length > 0) {
    config.fontDirs = fontDirs;
  }

  const videos = parseKeyValues(flags.video, 'video');

  if (Object.keys(videos).length > 0) {
    config.userVideoPaths = Object.fromEntries(
      Object.entries(videos).map(([section, file]) => [section, path.resolve(cwd, file)])
    );
  }

  if (flags.locale) {
    config.currentLocale = flags.locale;
  }

  if (flags.deterministic !== undefined) {
    config.deterministic = flags.deterministic;
  }

  if (flags.qc) {
    config.qc = { content: true };
  }

  if (flags.cache) {
    config.cacheDir = path.resolve(cwd, flags.cache);
  }

  if (flags.format) {
    config.format = parseFormatFlag(flags.format);
  }

  return config;
}

/**
 * Apply the `--orientation` override to the loaded template. The engine resolves orientation from
 * `descriptor.global.orientation` (TemplateDirector), never from ProjectConfig — the old
 * `videoConfig: { orientation }` forwarding was a silent no-op. Validates against the engine's own
 * enum so a typo fails fast with the flag name instead of a schema error mid-compile.
 */
export function withOrientation(template: TemplateDescriptor, orientation: string | undefined): TemplateDescriptor {
  if (!orientation) {
    return template;
  }

  const parsed = OrientationSchema.safeParse(orientation);

  if (!parsed.success) {
    throw new Error(`--orientation expects ${OrientationSchema.options.join(' | ')}, got "${orientation}"`);
  }

  return { ...template, global: { ...template.global, orientation: parsed.data } };
}
