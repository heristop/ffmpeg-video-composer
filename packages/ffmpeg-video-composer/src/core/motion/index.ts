// The motion system (docs/plans/motion-system.md §2–3): curves, their lowering to FFmpeg
// expressions, motion tokens and keyframe tracks.
export {
  NAMED_CURVES,
  CSS_BEZIERS,
  cubicBezier,
  springPosition,
  springSettleTime,
  springCurve,
  pointsCurve,
  type Curve,
  type CurveFn,
  type SpringParams,
} from './curves';
export {
  LEGACY_EASINGS,
  EasingError,
  easingError,
  isLegacyEasing,
  parseEasing,
  validSpring,
  type EasingSpec,
  type LegacyEasing,
} from './easing';
export { TOLERANCE, easedProgressExpr, segment, type Window } from './hermite';
export {
  BUILTIN_MOTION_TOKENS,
  resolveEasingRef,
  resolveMotionDescriptor,
  resolveTimeRef,
  resolveTokens,
  type MotionTokenSet,
  type ResolvedTokens,
} from './tokens';
export { applyTracks, keyTimesError, resolveKeyTimes, trackExpr, type AnimateTracks, type TrackKey } from './tracks';
export { motionCatalog, partialCatalog, type MotionCatalog, type PartialSummary } from './catalog';
export {
  BUILTIN_MOTION_ROLES,
  MOTION_ROLE_NAMES,
  curveOvershoot,
  effectiveRoles,
  headlineHoldSeconds,
  type MotionRoleDefinition,
  type MotionRoleName,
} from './roles';
