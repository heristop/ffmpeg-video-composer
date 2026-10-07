// The determinism contract (docs/plans/motion-system.md §1): pure, platform-neutral helpers that
// every entry point can re-export.
export { fnv1a32, deriveSeed, seededRandom, canonicalJson } from './hash';
export { sha256Hex } from './sha256';
export { templateRevision } from './template-revision';
export { MAX_SEED, resolveSeed, resolveDeterministic } from './contract';
export { findNondeterministicExpressions, type NondeterministicFinding } from './hygiene';
export { BITEXACT_OUTPUT_ARGS, X264_THREADS, applyDeterministicProfile, injectOutputArgs } from './command-tap';
export {
  MANIFEST_SCHEMA_VERSION,
  buildRenderManifest,
  graphDigest,
  normalizeCommand,
  templateDigest,
  type ManifestExtras,
  type ManifestRoots,
  type RenderManifest,
} from './manifest';
export { PLAN_HASH_SCHEMA, computePlanHash, type PlanHashInput } from './plan-hash';
export type { CommandInterceptor } from './command-tap';
// The output QC report a Node render carries in its manifest (core/qc).
export type { LoudnessReport, QcExpectations, QcFinding, QcKind, QcOption, QcReport, QcStatus } from '../qc/types';
