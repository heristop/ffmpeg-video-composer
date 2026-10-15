// Reference-structure analysis: a clip's shots, rhythm and layout as binding prompt rules. Pure and
// platform-neutral, on the frames the reference-style samplers already decode.
export { analyzeStructure } from './analyze';
export { findBoundaries, frameTime, DEFAULT_FRAME_INTERVAL } from './shots';
export { anchorOf, groundOf, motionOf } from './shot-traits';
export { structurePromptRules, structureDrift, LECLAP_TRANSITION, type DriftIssue } from './prompt';
export type { Anchor, Boundary, Ground, ReferenceStructure, Shot, StructureInput, TransitionGuess } from './types';
