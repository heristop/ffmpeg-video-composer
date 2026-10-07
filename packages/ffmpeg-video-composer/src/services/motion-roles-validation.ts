// Descriptor rules for global.motion.roles (core/motion/roles.ts): a role's ease must parse once its
// `$token` is resolved and may not point at another role; a duration token must exist.
//
// - invalid_motion_token: the role ease references a role, does not parse, or its duration token is unknown.

import { easingError, type EasingSpec } from '@/core/motion/easing';
import { resolveTokens, type MotionTokenSet } from '@/core/motion/tokens';
import type { MotionRoleDefinition } from '@/core/motion/roles';
import type { ValidationError } from './validation/types';

function invalid(path: string, message: string, hint?: string): ValidationError {
  return { path, message, code: 'invalid_motion_token', ...(hint && { hint }), kind: 'judgement' };
}

function easeError(ease: EasingSpec, path: string, motion: MotionTokenSet): ValidationError | null {
  if (typeof ease === 'string' && ease.trim().startsWith('$role.')) {
    return invalid(path, 'a role ease cannot reference another role', 'Use a curve or a token such as "$expo".');
  }

  const easings = resolveTokens({ ...motion, roles: undefined }).easings;
  const token = typeof ease === 'string' && ease.startsWith('$') ? ease.slice(1) : null;

  if (token !== null && !Object.hasOwn(easings, token)) {
    return invalid(path, `unknown motion token "$${token}"`, 'Define it in global.motion.springs/curves.');
  }

  const message = easingError(token === null ? ease : easings[token]);

  return message ? invalid(path, message) : null;
}

function durationError(duration: unknown, path: string, motion: MotionTokenSet): ValidationError | null {
  if (typeof duration !== 'string') return null;

  const durations = resolveTokens({ ...motion, roles: undefined }).durations;

  return Object.hasOwn(durations, duration.slice(1))
    ? null
    : invalid(path, `unknown duration token "${duration}"`, `Use one of: ${Object.keys(durations).join(', ')}.`);
}

/** Findings for every authored role definition. */
export function motionRoleErrors(motion: MotionTokenSet | undefined): ValidationError[] {
  const roles = (motion?.roles ?? {}) as Record<string, MotionRoleDefinition | undefined>;

  return Object.entries(roles).flatMap(([name, role]) => {
    if (!role || !motion) return [];

    const path = `global.motion.roles.${name}`;

    return [
      easeError(role.ease, `${path}.ease`, motion),
      durationError(role.duration, `${path}.duration`, motion),
    ].filter((error): error is ValidationError => error !== null);
  });
}
