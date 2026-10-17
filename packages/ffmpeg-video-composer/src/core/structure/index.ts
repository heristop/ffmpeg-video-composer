// Reference-structure analysis: a clip's shots, rhythm and layout as binding prompt rules. Pure and
// platform-neutral, on the frames the reference-style samplers already decode. Only the public API is
// re-exported here (the engine root publishes it); tuning helpers stay in their modules.
export { analyzeStructure } from './analyze';
export { structurePromptRules, structureDrift, LECLAP_TRANSITION, type DriftIssue } from './prompt';
export type { ReferenceStructure, StructureInput, TransitionGuess } from './types';
export type { Shot as ReferenceShot, Anchor as ShotAnchor, Ground as ShotGround } from './types';
