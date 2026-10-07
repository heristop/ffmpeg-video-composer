// Node-only per-section render cache (`ProjectConfig.cacheDir`). A section's segment is a pure function
// of its FFmpeg command, the bytes of the files that command reads, the FFmpeg build and the engine, so
// the key hashes exactly those: the normalized command (machine paths rewritten to placeholders, see
// core/determinism/manifest.ts), the input digests, the `ffmpeg -version` line and the engine version.
// On a hit the cached segment is copied into place instead of running FFmpeg. Entries are written to a
// temp file, renamed into place, then marked complete; only marked entries are ever read, so a crash
// or a concurrent writer can never serve a partial segment.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CommandInterceptor } from '@/core/determinism/command-tap';
import { normalizeCommand, type ManifestRoots } from '@/core/determinism/manifest';
import { canonicalJson } from '@/core/determinism/hash';
import { sha256Hex } from '@/core/determinism/sha256';
import { ENGINE_VERSION } from '@/core/version';
import { parseCommand } from '../platform/ffmpeg/parse-command';
import { commandInputFiles, fileDigest, isFile } from './command-inputs-node';

export const SECTION_CACHE_SCHEMA = 'leclap-section/1';

export interface SectionCacheStats {
  hits: number;
  misses: number;
  /** One entry per section render, in execution order: the segment file name and whether it was a hit. */
  sections: Array<{ output: string; hit: boolean }>;
}

export interface SectionCache {
  intercept: CommandInterceptor;
  stats: SectionCacheStats;
}

export interface SectionCacheOptions {
  dir: string;
  buildDir: string;
  roots: ManifestRoots;
  ffmpegVersionLine: string;
}

// Section segments are `<buildDir>/<name>_output.mp4` (director/section-infos.ts). Everything else (the
// joins, the audio passes) reads intermediate files whose content a command string can't vouch for.
function sectionOutput(command: string, buildDir: string): string | null {
  const output = parseCommand(command).at(-1);

  if (!output?.endsWith('_output.mp4')) return null;

  return path.dirname(path.resolve(output)) === path.resolve(buildDir) ? output : null;
}

/** The cache key of one section command. */
export async function sectionCacheKey(command: string, options: SectionCacheOptions): Promise<string> {
  const files = commandInputFiles(command);
  const inputs = await Promise.all(
    files.map(async (file) => ({ path: normalizeCommand(file, options.roots), sha256: await fileDigest(file) }))
  );

  return sha256Hex(
    canonicalJson({
      schema: SECTION_CACHE_SCHEMA,
      command: normalizeCommand(command, options.roots),
      inputs,
      ffmpeg: options.ffmpegVersionLine,
      engine: ENGINE_VERSION,
    })
  );
}

function entryPath(dir: string, key: string): string {
  return path.join(dir, key.slice(0, 2), `${key}.mp4`);
}

// Copy through a temp name in the target's directory, then rename: readers never see a partial file.
async function atomicCopy(source: string, target: string): Promise<void> {
  const temp = `${target}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, temp);
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true });

    throw error;
  }
}

async function store(entry: string, output: string): Promise<void> {
  try {
    await atomicCopy(output, entry);
    await fs.writeFile(`${entry}.ok`, '');
  } catch {
    // Best effort: a cache that cannot be written only costs the next render a re-encode.
  }
}

// A hit whose copy fails (entry removed meanwhile, disk full) falls back to rendering.
async function restore(entry: string, output: string): Promise<boolean> {
  try {
    await atomicCopy(entry, output);

    return true;
  } catch {
    return false;
  }
}

function isComplete(entry: string): boolean {
  return isFile(`${entry}.ok`) && isFile(entry);
}

export function createSectionCache(options: SectionCacheOptions): SectionCache {
  const stats: SectionCacheStats = { hits: 0, misses: 0, sections: [] };

  async function intercept(
    command: string,
    run: (command: string) => Promise<{ rc: number }>
  ): Promise<{ rc: number }> {
    const output = sectionOutput(command, options.buildDir);

    if (!output) return run(command);

    const entry = entryPath(options.dir, await sectionCacheKey(command, options));
    const hit = isComplete(entry) && (await restore(entry, output));
    stats.sections.push({ output: path.basename(output), hit });

    if (hit) {
      stats.hits += 1;

      return { rc: 0 };
    }

    stats.misses += 1;
    const result = await run(command);

    if (result.rc === 0 && isFile(output)) await store(entry, output);

    return result;
  }

  return { intercept, stats };
}
