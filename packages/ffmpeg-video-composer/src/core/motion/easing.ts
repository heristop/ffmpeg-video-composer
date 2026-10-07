// Parses an easing spec into a Curve. The grammar (docs/plans/motion-system.md §2.1):
//
//   linear | ease | ease-in | ease-out | ease-in-out | ease-out-back       CSS / historical names
//   ease-out-expo | ease-in-out-sine | ease-out-elastic | …                 the NAMED_CURVES set
//   cubic-bezier(x1, y1, x2, y2)                                            CSS, y may overshoot
//   spring(stiffness, damping[, mass[, velocity]])                          physical, closed form
//   steps(count[, start|end])                                               stop-motion
//   $token                                                                  global.motion / built-in token
//   { "points": [[0,0],[0.4,1.08],[1,1]] }                                  custom curve
//
// The four historical names (linear, ease-out, ease-in-out, ease-out-back) keep their exact legacy
// expressions (editor/presets/text.ts); this module covers the rest.

import {
  CSS_BEZIERS,
  NAMED_CURVES,
  cubicBezier,
  pointsCurve,
  springCurve,
  type Curve,
  type SpringParams,
} from './curves';

export type EasingSpec = string | { points: Array<[number, number]> };

export const LEGACY_EASINGS = ['linear', 'ease-out', 'ease-in-out', 'ease-out-back'] as const;
export type LegacyEasing = (typeof LEGACY_EASINGS)[number];

export function isLegacyEasing(spec: unknown): spec is LegacyEasing {
  return typeof spec === 'string' && (LEGACY_EASINGS as readonly string[]).includes(spec);
}

export class EasingError extends Error {}

export const MIN_DAMPING_RATIO = 0.1;

// The legacy names as curves, for the cases (tracks) that sample rather than reuse the legacy strings.
const LEGACY_CURVES: Record<LegacyEasing, Curve['fn']> = {
  linear: (p) => p,
  'ease-out': (p) => 1 - (1 - p) ** 3,
  'ease-in-out': (p) => p * p * (3 - 2 * p),
  'ease-out-back': (p) => p * (1 + (p - 1) * (2.70158 * (p - 1) - 1)),
};

function numbers(args: string, name: string, min: number, max: number): number[] {
  const values = args.split(',').map((part) => Number(part.trim()));

  if (values.length < min || values.length > max || values.some((value) => !Number.isFinite(value))) {
    throw new EasingError(`${name}() expects ${min === max ? min : `${min}-${max}`} numbers, got "${args}"`);
  }

  return values;
}

function parseSpring(args: string): Curve {
  const [stiffness, damping, mass = 1, velocity = 0] = numbers(args, 'spring', 2, 4);

  return springCurve(validSpring({ stiffness, damping, mass, velocity }));
}

/** Physical bounds keep every spring renderable: it settles within the 10 s cap and never explodes. */
export function validSpring(params: SpringParams): SpringParams {
  const { stiffness, damping, mass = 1, velocity = 0 } = params;

  if (stiffness < 1 || stiffness > 2000) throw new EasingError(`spring stiffness ${stiffness} outside 1..2000`);

  if (damping < 1 || damping > 200) throw new EasingError(`spring damping ${damping} outside 1..200`);

  if (mass < 0.1 || mass > 20) throw new EasingError(`spring mass ${mass} outside 0.1..20`);

  if (Math.abs(velocity) > 50) throw new EasingError(`spring velocity ${velocity} outside -50..50`);

  // Below ζ = 0.1 a spring rings for dozens of cycles: a vibrating string, not motion, and an
  // unbounded expression. ζ = 0.1 still overshoots by ~73%.
  const ratio = damping / (2 * Math.sqrt(stiffness * mass));

  if (ratio < MIN_DAMPING_RATIO) {
    throw new EasingError(`spring damping ratio ${ratio.toFixed(3)} below ${MIN_DAMPING_RATIO} (raise damping)`);
  }

  return { stiffness, damping, mass, velocity };
}

function parseBezier(args: string): Curve {
  const [x1, y1, x2, y2] = numbers(args, 'cubic-bezier', 4, 4);

  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new EasingError('cubic-bezier x1/x2 must lie in 0..1');

  if (Math.abs(y1) > 5 || Math.abs(y2) > 5) throw new EasingError('cubic-bezier y1/y2 must lie in -5..5');

  return { fn: cubicBezier(x1, y1, x2, y2) };
}

function parseSteps(args: string): Curve {
  const [countText, positionText = 'end'] = args.split(',').map((part) => part.trim());
  const count = Number(countText);

  if (!Number.isInteger(count) || count < 1 || count > 120) throw new EasingError('steps() count must be 1..120');

  if (positionText !== 'start' && positionText !== 'end') throw new EasingError('steps() position is start or end');

  const round = positionText === 'end' ? Math.floor : Math.ceil;

  return { fn: (p) => (p >= 1 ? 1 : round(p * count) / count), steps: { count, position: positionText } };
}

function parsePoints(points: ReadonlyArray<readonly [number, number]>): Curve {
  const ordered = points.every((point, i) => i === 0 || point[0] >= points[i - 1][0]);
  const anchored = points.length >= 2 && points[0][0] === 0 && points.at(-1)?.[0] === 1;

  if (!ordered || !anchored) throw new EasingError('points must start at p=0, end at p=1 and never go back in p');

  return { fn: pointsCurve(points) };
}

const FUNCTIONS: Record<string, (args: string) => Curve> = {
  spring: parseSpring,
  'cubic-bezier': parseBezier,
  steps: parseSteps,
};

/**
 * The Curve for a spec. Token references (`$name`) must already be resolved (core/motion/tokens.ts);
 * an unresolved one is an error here, as is anything outside the grammar.
 */
export function parseEasing(spec: EasingSpec): Curve {
  if (typeof spec !== 'string') return parsePoints(spec.points);

  const text = spec.trim();

  if (isLegacyEasing(text)) return { fn: LEGACY_CURVES[text] };

  if (Object.hasOwn(NAMED_CURVES, text)) return { fn: NAMED_CURVES[text] };

  if (Object.hasOwn(CSS_BEZIERS, text)) return { fn: cubicBezier(...CSS_BEZIERS[text]) };

  const call = /^([a-z-]+)\((.*)\)$/.exec(text);

  if (call && Object.hasOwn(FUNCTIONS, call[1])) return FUNCTIONS[call[1]](call[2]);

  if (text.startsWith('$')) throw new EasingError(`unresolved motion token "${text}"`);

  throw new EasingError(`unknown easing "${text}"`);
}

/** Validation-friendly variant: the error message, or null when the spec parses. */
export function easingError(spec: EasingSpec): string | null {
  try {
    parseEasing(spec);

    return null;
  } catch (error) {
    if (error instanceof EasingError) return error.message;

    throw error;
  }
}
