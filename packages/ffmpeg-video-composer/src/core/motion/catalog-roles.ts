// The motion-role section of the motion catalog: each role's built-in ease/duration/overshoot, what it is
// for, and the rules the role lint enforces.

import {
  BUILTIN_MOTION_ROLES,
  HEADLINE_HOLD,
  MOTION_ROLE_GUIDES,
  MOTION_ROLE_NAMES,
  type MotionRoleDefinition,
  type MotionRoleGuide,
  type MotionRoleName,
} from './roles';

export interface MotionRolesCatalog {
  defaults: Record<MotionRoleName, MotionRoleDefinition & MotionRoleGuide>;
  /** Where `role` is accepted. */
  fields: string[];
  rules: string[];
  /** Advisory motionWarnings codes these rules raise. */
  warnings: string[];
}

export function motionRolesCatalog(): MotionRolesCatalog {
  return {
    defaults: Object.fromEntries(
      MOTION_ROLE_NAMES.map((name) => [name, { ...BUILTIN_MOTION_ROLES[name], ...MOTION_ROLE_GUIDES[name] }])
    ) as MotionRolesCatalog['defaults'],
    fields: [
      'kinetic[].role',
      'graphics[].role',
      'filters[].role (drawtext: reveal, exit, animate keys)',
      'titleCard.role',
      'lowerThird.role',
      'camera.role (preset move and track keys)',
    ],
    rules: [
      'Give every animated element a role instead of an ease: the role decides the curve, so the film moves ' +
        'with one vocabulary. Override a role in global.motion.roles.<name> = { ease, duration?, overshoot? }.',
      'A role fills only what the element leaves unset: an explicit ease wins (and keeps its own duration); ' +
        "an explicit duration keeps the role's curve.",
      '$role.<name> is a token: use it as any ease ("ease": "$role.panel") or as a keyframe duration ("t": "+$role.micro").',
      'Overshoot is a budget: one or two playful elements (mascot, accent) per beat; micro and panels settle.',
      `Headlines land, then hold at least ${HEADLINE_HOLD.base} s + words / ${HEADLINE_HOLD.wordsPerSecond} s ` +
        'before they exit or the section cuts.',
    ],
    warnings: ['overshoot_overuse', 'headline_hold_short'],
  };
}
