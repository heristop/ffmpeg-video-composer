// Stages the compile-time matte images the designed boundaries read (core/motion/transition-mattes.ts) to the
// build FS before the transition assembly, and builds their `-i` inputs. A boundary whose window cannot be
// drawn (font unreadable, glyph without a counter, window too small) logs why and renders without it: a
// shaped iris falls back to the circle, a zoom-through to the plain fly-through.

import { kineticFontFile } from '@/core/kinetic/resolve';
import { parseGlyphOutlines, type GlyphFont } from '@/core/glyph-outline';
import { boundaryMatte, matteFont, type MatteRequest } from '@/core/motion/transition-mattes';
import type { ThroughMatte } from '@/core/motion/transition-through';
import { fmt } from '@/core/motion/hermite';

/** The filesystem calls staging needs (an AbstractFilesystem). */
export interface MatteFs {
  getBuildPath: (dir: string) => Promise<string>;
  getAssetsDir: (dir: string) => string | undefined;
  readFile: (path: string) => Promise<Uint8Array>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
}

export interface MatteIO {
  fs: MatteFs;
  /** Directory the mattes are written to (the build dir). */
  dir: string;
  logger: { warn: (message: string) => void };
}

export interface StagedMatte {
  /** Boundary index. */
  k: number;
  path: string;
  centre: ThroughMatte['centre'];
  scale: number;
}

/** The `-i` arguments of a still matte held for `duration` seconds (plus a frame) at `fps`. */
export function matteInputArgs(path: string, fps: number, duration: number): string {
  return ` -loop 1 -framerate ${fps} -t ${fmt(duration + 1 / fps)} -i ${path} `;
}

/**
 * The staged mattes' `-i` arguments, numbered from input `base`, and each boundary's matte pad (undefined for a
 * boundary without one; no list at all when no boundary has one).
 */
export function matteInputs(
  mattes: readonly StagedMatte[],
  at: { base: number; fps: number; durations: readonly number[] }
): { args: string; labels: Array<ThroughMatte | undefined> | undefined } {
  const args = mattes.map((matte) => matteInputArgs(matte.path, at.fps, at.durations[matte.k])).join('');
  const byBoundary = new Map(mattes.map((matte, i) => [matte.k, { ...matte, label: `${at.base + i}:v` }]));
  const labels = at.durations.map((_, k) => {
    const matte = byBoundary.get(k);

    return matte && { label: matte.label, centre: matte.centre, scale: matte.scale };
  });

  return { args, labels: mattes.length > 0 ? labels : undefined };
}

// A font staged for the sections (build fonts dir), else the bundled copy in the assets dir.
async function readFont(fs: MatteFs, file: string): Promise<Uint8Array | null> {
  const dirs = [await fs.getBuildPath('fonts'), fs.getAssetsDir('fonts')].filter((dir): dir is string => Boolean(dir));
  const reads = await Promise.allSettled(dirs.map((dir) => fs.readFile(`${dir}/${file}`)));
  const found = reads.find((read) => read.status === 'fulfilled');

  return found?.status === 'fulfilled' ? found.value : null;
}

async function fontFor(request: MatteRequest, fs: MatteFs): Promise<GlyphFont | null> {
  const font = matteFont(request);

  if (font === undefined) return null;

  const bytes = await readFont(fs, kineticFontFile(font ?? undefined));

  return bytes ? parseGlyphOutlines(bytes) : null;
}

async function stageOne(request: MatteRequest, k: number, frame: { width: number; height: number }, io: MatteIO) {
  const result = boundaryMatte(request, frame, await fontFor(request, io.fs));

  if (!result.matte) {
    if (result.reason) {
      io.logger.warn(`[Transitions] ${request.type} at boundary ${k}: ${result.reason}; rendered without it`);
    }

    return null;
  }

  const path = `${io.dir}/${result.matte.name}`;
  await io.fs.writeFile(path, result.matte.png());

  return { k, path, centre: result.matte.centre, scale: result.matte.scale };
}

/** Writes each boundary's matte and returns where it is; boundaries without one are left out. */
export async function stageTransitionMattes(
  transitions: readonly MatteRequest[],
  frame: { width: number; height: number },
  io: MatteIO
): Promise<StagedMatte[]> {
  const staged = await Promise.all(transitions.map((request, k) => stageOne(request, k, frame, io)));

  return staged.filter((matte): matte is StagedMatte => matte !== null);
}
