import { CSS_BEZIERS, NAMED_CURVES } from '@/core/motion/curves';
import { LEGACY_EASINGS } from '@/core/motion/easing';
import { nearest } from './suggest';
import type { ValidationError } from './types';

const EASING_NAMES = [...LEGACY_EASINGS, ...Object.keys(NAMED_CURVES), ...Object.keys(CSS_BEZIERS)];

const EASING_GRAMMAR_HINT =
  'Use a named easing (e.g. "ease-out", "ease-out-expo"), cubic-bezier(x1, y1, x2, y2), steps(n), ' +
  'spring(stiffness, damping) or a $token.';

/** Hint, and the nearest named easing as the suggestion, for an easing string that does not parse. */
export function withEasingHint(finding: ValidationError, spec: unknown): ValidationError {
  const near = typeof spec === 'string' && !spec.includes('(') ? nearest(spec.trim(), EASING_NAMES) : undefined;

  if (near === undefined) return { ...finding, hint: EASING_GRAMMAR_HINT, kind: 'judgement' };

  return { ...finding, hint: `Use "${near}".`, suggestion: near, kind: 'format' };
}
