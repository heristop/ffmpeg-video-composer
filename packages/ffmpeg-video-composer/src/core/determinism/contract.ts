// The determinism contract's descriptor-level switches (docs/plans/motion-system.md §1): the seed
// every procedural element derives from, and whether a render applies the deterministic encoder profile.

/** Upper bound of `global.seed` (uint32). */
export const MAX_SEED = 0xffffffff;

interface ContractSource {
  global?: { seed?: number; fps?: number } | null;
}

export function resolveSeed(descriptor: ContractSource | undefined): number {
  const seed = descriptor?.global?.seed;

  return typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED ? seed : 0;
}

/**
 * Whether a render applies the deterministic encoder profile (bit-exact muxing, fixed encoder threads).
 * On by default; an explicit `ProjectConfig.deterministic: false` opts out (e.g. for faster local drafts).
 */
export function resolveDeterministic(configured: boolean | undefined): boolean {
  return configured ?? true;
}
