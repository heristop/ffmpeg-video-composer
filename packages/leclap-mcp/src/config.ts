import os from 'node:os';
import path from 'node:path';
import type { JsonEffectCatalog } from './effects/custom-effect-catalog.js';

// Runtime config for the MCP server. Precedence per field: CLI flag > env var > default.
// Dirs are resolved to absolute paths but never created here — the compose tool creates
// per-render output dirs on demand (Task 4).
export interface McpConfig {
  /** Operator JSON catalog path; read once when creating the server. */
  effectCatalogPath?: string;
  /** Parsed, immutable, plain JSON startup snapshot (also supported by direct tool callers). */
  effectCatalog?: JsonEffectCatalog;
  /** Persistent registered-effect cache budget; zero disables it. Defaults to 512 MiB. */
  effectCacheMaxBytes?: number;
  outputDir: string;
  mediaDir: string;
  renderTimeoutMs: number;
  /**
   * Enable the render_remotion_clip tool. It bundles and EXECUTES a caller-supplied Remotion entry
   * (arbitrary local JS) in headless Chromium, so it is an RCE surface unless the client is trusted.
   * Off by default; opt in with --allow-remotion / LECLAP_MCP_ALLOW_REMOTION for local design-time use.
   */
  allowRemotion: boolean;
  /** Default Remotion entry (the module that calls registerRoot) for render_remotion_clip; optional. */
  remotionEntry?: string;
  /** Optional host Chromium/Chrome executable for registered effect rendering. */
  browserExecutable?: string;
  /**
   * JSONL log report_catalog_gap appends to, relative to (and always under) outputDir. Defaults to
   * `catalog-gaps.jsonl`.
   */
  catalogGapLog?: string;
}

const DEFAULT_RENDER_TIMEOUT_MS = 600_000;

// A boolean flag: present as a bare `--flag` (or `--flag=true`/`1`), else the env var when truthy.
// Self-contained (no positional readFlag lookup) so a bare `--flag` never swallows the next argv.
function readBoolean(argv: readonly string[], flag: string, envValue: string | undefined): boolean {
  if (argv.includes(flag)) {
    return true;
  }

  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));

  if (inline !== undefined) {
    const value = inline.slice(flag.length + 1);

    return value === 'true' || value === '1';
  }

  return envValue === 'true' || envValue === '1';
}

// Minimal `--flag value` parser — no new dep. Returns the value following the flag, or
// undefined when absent. Supports both `--flag value` and `--flag=value`.
function readFlag(argv: readonly string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));

  if (inline !== undefined) {
    return inline.slice(prefix.length);
  }

  const index = argv.indexOf(flag);

  // A value-taking flag with no value (end of argv, or immediately followed by another `--flag`)
  // must read as absent rather than swallowing the following flag as its value.
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }

  const next = argv[index + 1];

  if (next.startsWith('--')) {
    return undefined;
  }

  return next;
}

const MAX_TIMER_MS = 2_147_483_647;

function resolveTimeout(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_RENDER_TIMEOUT_MS;
  }

  // Node clamps timers above 2^31-1 ms to 1 ms, so larger values would fail every render immediately.
  const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_TIMER_MS) {
    return DEFAULT_RENDER_TIMEOUT_MS;
  }

  return parsed;
}

function resolveEffectCacheBudget(raw: string | undefined): number {
  const parsed = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN;

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 512 * 1024 * 1024;
}

function catalogPathConfig(argv: readonly string[]): Pick<McpConfig, 'effectCatalogPath'> {
  const file = readFlag(argv, '--effect-catalog') ?? process.env.LECLAP_MCP_EFFECT_CATALOG;

  return file ? { effectCatalogPath: path.resolve(file) } : {};
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

function gapLogConfig(argv: readonly string[]): Pick<McpConfig, 'catalogGapLog'> {
  const catalogGapLog = nonEmpty(readFlag(argv, '--catalog-gap-log') ?? process.env.LECLAP_MCP_CATALOG_GAP_LOG);

  return catalogGapLog ? { catalogGapLog } : {};
}

export function loadConfig(argv: readonly string[] = process.argv): McpConfig {
  // An empty value counts as unset: path.resolve('') is the working directory, which would widen the
  // media sandbox to wherever the server was started.
  const outputDir =
    nonEmpty(readFlag(argv, '--output-dir')) ??
    nonEmpty(process.env.LECLAP_MCP_OUTPUT_DIR) ??
    path.join(os.homedir(), '.leclap', 'renders');

  // Narrow default: confining reads to the whole home directory would let probe_media/compose_video
  // read any file under $HOME. Operators who keep media elsewhere set --media-dir / LECLAP_MCP_MEDIA_DIR.
  const mediaDir =
    nonEmpty(readFlag(argv, '--media-dir')) ??
    nonEmpty(process.env.LECLAP_MCP_MEDIA_DIR) ??
    path.join(os.homedir(), '.leclap', 'media');

  const renderTimeoutMs = resolveTimeout(
    readFlag(argv, '--render-timeout-ms') ?? process.env.LECLAP_MCP_RENDER_TIMEOUT_MS
  );

  const remotionEntry = readFlag(argv, '--remotion-entry') ?? process.env.LECLAP_MCP_REMOTION_ENTRY;
  const browserExecutable = readFlag(argv, '--remotion-browser') ?? process.env.LECLAP_MCP_REMOTION_BROWSER;
  const allowRemotion = readBoolean(argv, '--allow-remotion', process.env.LECLAP_MCP_ALLOW_REMOTION);

  return {
    outputDir: path.resolve(outputDir),
    mediaDir: path.resolve(mediaDir),
    renderTimeoutMs,
    effectCacheMaxBytes: resolveEffectCacheBudget(
      readFlag(argv, '--effect-cache-max-bytes') ?? process.env.LECLAP_MCP_EFFECT_CACHE_MAX_BYTES
    ),
    allowRemotion,
    ...catalogPathConfig(argv),
    ...(browserExecutable ? { browserExecutable: path.resolve(browserExecutable) } : {}),
    ...(remotionEntry ? { remotionEntry: path.resolve(remotionEntry) } : {}),
    ...gapLogConfig(argv),
  };
}
