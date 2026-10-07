// The `.cube` text a lut3d spec stages (presets/lut-spec.ts): a generated preset LUT, optionally blended
// toward identity, or a user `.cube` read through the platform filesystem, validated and re-serialised
// at its strength. Deterministic — the same spec and source bytes always stage the same file.

import { blendTowardIdentity, CubeParseError, parseCube, serializeCube } from '@/core/footage/lut-cube';
import { cubeFor } from './lut-library';
import { parseLutValue } from './lut-spec';

/** Reads a user LUT's text from its (variable-mapped) URL or path. */
export type LutSourceReader = (url: string) => Promise<string>;

function userCube(url: string, text: string, strength: number): string {
  try {
    return serializeCube(blendTowardIdentity(parseCube(text), strength), `LeClap user LUT @ ${strength}`);
  } catch (error) {
    const reason = error instanceof CubeParseError ? `${error.message} (${error.code})` : String(error);

    throw new Error(`grade.lut "${url}" is not a valid 3D .cube: ${reason}`, { cause: error });
  }
}

/** The `.cube` text for a lut3d filter value, or null for an unknown preset name. */
export async function lutCubeText(value: string, readSource: LutSourceReader): Promise<string | null> {
  const spec = parseLutValue(value);

  if (spec.kind === 'preset') return cubeFor(spec.name, undefined, spec.strength);

  return userCube(spec.url, await readSource(spec.url), spec.strength);
}
