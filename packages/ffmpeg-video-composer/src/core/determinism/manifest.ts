// D7 — the render manifest: everything needed to prove (or re-check) that a video is the output of a
// given template. Pure: the caller supplies file digests, so this module runs on every platform and the
// Node entry adds the filesystem part (services/render-manifest-node.ts).

import { canonicalJson } from './hash';
import { sha256Hex } from './sha256';
import { resolveSeed } from './contract';
import { ENGINE_VERSION } from '../version';
import type { LoudnessReport, QcReport } from '../qc/types';

export const MANIFEST_SCHEMA_VERSION = 1;

export interface ManifestRoots {
  buildDir?: string;
  assetsDir?: string;
  tempDir?: string;
  /** Section name → user clip path; each is rewritten to `$VIDEO{name}`. */
  userVideoPaths?: Record<string, string>;
}

export interface RenderManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  engine: { name: 'ffmpeg-video-composer'; version: string };
  ffmpeg: { version: string | null };
  deterministic: boolean;
  template: {
    sha256: string;
    seed: number;
    /** The canonical descriptor that was rendered, so `leclap verify --rerender` can render it again. */
    descriptor: unknown;
  };
  config: Record<string, unknown>;
  assets: Array<{ path: string; sha256: string }>;
  graph: { sha256: string; commands: string[] };
  output: { sha256: string; bytes: number } | null;
  /** Digest of everything that decides the output bytes (core/determinism/plan-hash.ts). Node renders. */
  planHash?: string;
  /** Section cache use for this render (`ProjectConfig.cacheDir`, Node only). */
  cache?: { hits: number; misses: number; sections: Array<{ output: string; hit: boolean }> };
  /** The loudnorm pass actually applied, after the true-peak re-check. */
  loudness?: LoudnessReport;
  /** The output QC report, when `ProjectConfig.qc` asked for one. */
  qc?: QcReport;
}

/** The optional, Node-filled parts of a manifest. */
export type ManifestExtras = Pick<RenderManifest, 'planHash' | 'cache' | 'loudness' | 'qc'>;

export interface ManifestInput {
  descriptor: unknown;
  commands: readonly string[];
  roots: ManifestRoots;
  config: Record<string, unknown>;
  deterministic: boolean;
  ffmpegVersion: string | null;
  assets: Array<{ path: string; sha256: string }>;
  output: { sha256: string; bytes: number } | null;
  extras?: ManifestExtras;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function replaceAll(command: string, from: string | undefined, to: string): string {
  if (!from) return command;

  return command.replace(new RegExp(escapeRegExp(from.replace(/\/+$/, '')), 'g'), to);
}

/**
 * Rewrites the machine-specific parts of a command (build/asset/temp roots, user clip paths and the
 * unique suffix of temp files) into stable placeholders, so the same render on two machines yields the
 * same command text and therefore the same graph digest.
 */
export function normalizeCommand(command: string, roots: ManifestRoots): string {
  let normalized = command;

  for (const [name, clip] of Object.entries(roots.userVideoPaths ?? {})) {
    normalized = replaceAll(normalized, clip, `$VIDEO{${name}}`);
  }

  // Longest root first: a build dir inside the temp dir must become $BUILD, not $TMP/….
  const named: Array<[string | undefined, string]> = [
    [roots.tempDir, '$TMP'],
    [roots.buildDir, '$BUILD'],
    [roots.assetsDir, '$ASSETS'],
  ];

  for (const [root, placeholder] of named.sort((a, b) => (b[0]?.length ?? 0) - (a[0]?.length ?? 0))) {
    normalized = replaceAll(normalized, root, placeholder);
  }

  return normalized
    .replace(/_u\d+(?:-\d+)?(?=\.)/g, '_u#')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The graph digest: normalized commands, sorted. Segments may render concurrently, so execution order
 * isn't part of the contract; the set of commands is.
 */
export function graphDigest(commands: readonly string[], roots: ManifestRoots): RenderManifest['graph'] {
  const normalized = commands.map((command) => normalizeCommand(command, roots)).sort();

  return { sha256: sha256Hex(normalized.join('\n')), commands: normalized };
}

export function templateDigest(descriptor: unknown): string {
  return sha256Hex(canonicalJson(descriptor));
}

export function buildRenderManifest(input: ManifestInput): RenderManifest {
  const descriptor = input.descriptor as Parameters<typeof resolveSeed>[0];

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    engine: { name: 'ffmpeg-video-composer', version: ENGINE_VERSION },
    ffmpeg: { version: input.ffmpegVersion },
    deterministic: input.deterministic,
    template: {
      sha256: templateDigest(input.descriptor),
      seed: resolveSeed(descriptor),
      descriptor: JSON.parse(canonicalJson(input.descriptor)) as unknown,
    },
    config: input.config,
    assets: [...input.assets].sort((a, b) => a.path.localeCompare(b.path)),
    graph: graphDigest(input.commands, input.roots),
    output: input.output,
    ...input.extras,
  };
}
