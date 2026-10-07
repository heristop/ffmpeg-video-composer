// Node half of the render manifest (D7): read and digest the files a render consumed and produced, then
// hand everything to the pure builder in core/determinism/manifest.ts.

import fs from 'node:fs';
import path from 'node:path';
import type { ProjectConfig } from '@/core/types';
import { sha256Hex } from '@/core/determinism/sha256';
import { parseCommand } from '../platform/ffmpeg/parse-command';
import {
  buildRenderManifest,
  normalizeCommand,
  type ManifestExtras,
  type ManifestRoots,
  type RenderManifest,
} from '@/core/determinism/manifest';
import { computePlanHash } from '@/core/determinism/plan-hash';
import { ENGINE_VERSION } from '@/core/version';

export interface NodeManifestInput {
  descriptor: unknown;
  config: ProjectConfig;
  commands: readonly string[];
  deterministic: boolean;
  output: string;
  ffmpegVersion: string | null;
  tempDir?: string;
  /** First line of `ffmpeg -version`, for the plan hash. */
  ffmpegVersionLine?: string | null;
  /** The config after defaults were applied (encoder/quality fields of the plan hash). */
  resolvedConfig?: ProjectConfig;
  extras?: Omit<ManifestExtras, 'planHash'>;
}

// Keys whose string values name a file under assetsDir (overlay/animation/image urls, fonts, LUTs).
const ASSET_KEYS = new Set(['url', 'fontfile', 'font', 'file', 'lut', 'src']);

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function digestFile(file: string): { sha256: string; bytes: number } {
  const bytes = fs.readFileSync(file);

  return { sha256: sha256Hex(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)), bytes: bytes.length };
}

function collectDescriptorAssets(value: unknown, assetsDir: string, found: Set<string>, key = ''): void {
  if (typeof value === 'string') {
    const candidate = path.resolve(assetsDir, value);

    if (ASSET_KEYS.has(key) && !value.includes('{{') && isFile(candidate)) found.add(candidate);

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectDescriptorAssets(item, assetsDir, found, key);

    return;
  }

  if (value === null || typeof value !== 'object') return;

  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    collectDescriptorAssets(child, assetsDir, found, childKey);
  }
}

// `-i <file>` inputs that are real files outside the build/temp roots, i.e. sources rather than the
// build's own intermediates (which are covered by the graph digest and the output digest).
function collectCommandInputs(commands: readonly string[], scratch: string[], found: Set<string>): void {
  for (const command of commands) {
    const args = parseCommand(command);

    for (const [index, arg] of args.entries()) {
      const next = args.at(index + 1);
      const external = next !== undefined && !scratch.some((root) => next.startsWith(root));

      if (arg === '-i' && external && isFile(next)) found.add(path.resolve(next));
    }
  }
}

/** The machine roots a render's commands are normalized against (manifest graph, section cache keys). */
export function renderRoots(config: ProjectConfig, tempDir: string | undefined): ManifestRoots {
  return {
    buildDir: config.buildDir ? path.resolve(config.buildDir) : undefined,
    assetsDir: config.assetsDir ? path.resolve(config.assetsDir) : undefined,
    tempDir: tempDir ? path.resolve(tempDir) : undefined,
    userVideoPaths: config.userVideoPaths,
  };
}

function manifestRoots(input: NodeManifestInput): ManifestRoots {
  return renderRoots(input.config, input.tempDir);
}

/** Files under `assetsDir` the descriptor names (overlay/animation/image urls, fonts, LUTs). */
export function descriptorAssetFiles(descriptor: unknown, assetsDir: string): string[] {
  const found = new Set<string>();
  collectDescriptorAssets(descriptor, path.resolve(assetsDir), found);

  return [...found];
}

function digestAssets(input: NodeManifestInput, roots: ManifestRoots): RenderManifest['assets'] {
  const found = new Set<string>();
  const scratch = [roots.buildDir, roots.tempDir].filter((root): root is string => Boolean(root));

  for (const clip of Object.values(input.config.userVideoPaths ?? {})) {
    if (isFile(clip)) found.add(path.resolve(clip));
  }

  if (roots.assetsDir) collectDescriptorAssets(input.descriptor, roots.assetsDir, found);

  collectCommandInputs(input.commands, scratch, found);

  return [...found].map((file) => ({ path: normalizeCommand(file, roots), sha256: digestFile(file).sha256 }));
}

// The render-relevant config: what changes pixels or samples, never machine paths.
function relevantConfig(config: ProjectConfig): Record<string, unknown> {
  return {
    currentLocale: config.currentLocale ?? null,
    fields: config.fields ?? {},
    qualityTier: config.qualityTier ?? 'standard',
    videoCodec: config.codecConfig?.videoCodec ?? null,
    videoConfig: config.videoConfig ?? null,
    audioConfig: config.audioConfig ?? null,
    userVideoSections: Object.keys(config.userVideoPaths ?? {}).sort(),
  };
}

const FONT_FILE = /fontfile='?([^':,\s\]]+)/g;

// Every font file the drawtext filters load (the build's staged copies), digested by content.
function fontDigests(commands: readonly string[]): string[] {
  const files = new Set<string>();

  for (const command of commands) {
    for (const match of command.matchAll(FONT_FILE)) files.add(match[1]);
  }

  return [...files].filter(isFile).map((file) => digestFile(file).sha256);
}

// The encoder/quality part of the plan: what the resolved config feeds into the encoder arguments.
function encoderConfig(config: ProjectConfig): Record<string, unknown> {
  return {
    codecConfig: config.codecConfig ?? null,
    qualityTier: config.qualityTier ?? 'standard',
    preset: config.hardwareConfig?.preset ?? null,
    hwaccel: config.hardwareConfig?.hwaccel ?? null,
    deterministic: config.deterministic ?? true,
    videoConfig: config.videoConfig ?? null,
    audioConfig: config.audioConfig ?? null,
  };
}

export function createNodeRenderManifest(input: NodeManifestInput): RenderManifest {
  const roots = manifestRoots(input);
  const assets = digestAssets(input, roots);
  const planHash = computePlanHash({
    descriptor: input.descriptor,
    assetDigests: assets.map((asset) => asset.sha256),
    fontDigests: fontDigests(input.commands),
    encoder: encoderConfig(input.resolvedConfig ?? input.config),
    engineVersion: ENGINE_VERSION,
    ffmpegVersion: input.ffmpegVersionLine ?? input.ffmpegVersion,
  });

  return buildRenderManifest({
    descriptor: input.descriptor,
    commands: input.commands,
    roots,
    config: relevantConfig(input.config),
    deterministic: input.deterministic,
    ffmpegVersion: input.ffmpegVersion,
    assets,
    output: isFile(input.output) ? digestFile(input.output) : null,
    extras: { planHash, ...input.extras },
  });
}

/** Digest of a rendered file, for `verify` against a manifest's `output.sha256`. */
export function digestRenderedFile(file: string): { sha256: string; bytes: number } {
  return digestFile(file);
}
