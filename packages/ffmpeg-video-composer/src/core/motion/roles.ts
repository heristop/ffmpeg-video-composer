// Motion roles: one feel per class of object (micro UI bits, panels, camera, headlines, accents, mascots).
// `global.motion.roles` overrides the built-ins role by role; an element opts in with `role`, and
// `$role.<name>` is a token like any other. Roles are applied inside the token pass (tokens.ts), so the
// lowering only ever sees plain eases and seconds — and a descriptor without `role` is left untouched.

import { EasingError, parseEasing, type EasingSpec } from './easing';

export const MOTION_ROLE_NAMES = ['micro', 'panel', 'camera', 'headline', 'accent', 'mascot'] as const;
export type MotionRoleName = (typeof MOTION_ROLE_NAMES)[number];
export type Overshoot = 'none' | 'subtle' | 'playful';

export interface MotionRoleDefinition {
  ease: EasingSpec;
  /** Seconds or a duration token (`$base`). */
  duration?: number | string;
  overshoot?: Overshoot;
}

export interface MotionRoleGuide {
  useFor: string;
  avoid: string;
}

/** Built-in roles. Eases may be tokens: they resolve against the template's (possibly overridden) tokens. */
export const BUILTIN_MOTION_ROLES: Readonly<Record<MotionRoleName, MotionRoleDefinition>> = {
  micro: { ease: 'ease-out-cubic', duration: 0.2, overshoot: 'none' },
  panel: { ease: '$expo', duration: 0.55, overshoot: 'none' },
  camera: { ease: 'ease-in-out-sine', overshoot: 'none' },
  headline: { ease: '$expo', duration: 0.7, overshoot: 'none' },
  accent: { ease: '$snappy', overshoot: 'subtle' },
  mascot: { ease: '$bouncy', overshoot: 'playful' },
};

export const MOTION_ROLE_GUIDES: Readonly<Record<MotionRoleName, MotionRoleGuide>> = {
  micro: {
    useFor: 'chips, icons, toggles, small labels: arrives fast and settles without a wobble',
    avoid: 'springs that bounce: a bouncing icon reads as a glitch',
  },
  panel: {
    useFor: 'cards, backing plates, frames, lower-third bands: a controlled deceleration into place',
    avoid: 'overshoot: a panel that overshoots looks loose and drags the copy on it',
  },
  camera: {
    useFor: 'push-ins, drifts, orbits: the viewer should feel the move, not see the curve',
    avoid: 'snappy or overshooting curves: they read as a bumped tripod',
  },
  headline: {
    useFor: 'the hero line of a beat: a strong entrance, then a stable hold long enough to read',
    avoid: 'exits right after landing: hold 0.4 s + words / 3.5 s after the last unit lands',
  },
  accent: {
    useFor: 'one emphasised word, an underline, a flash: a snappy hit with a hint of overshoot',
    avoid: 'more than one accent per idea',
  },
  mascot: {
    useFor: 'characters, stickers, playful props: the one place a visible bounce belongs',
    avoid: 'giving copy or panels the mascot feel: keep overshoot for one or two playful elements',
  },
};

/** The catalog hold rule: a headline holds at least `base + words / wordsPerSecond` seconds after it lands. */
export const HEADLINE_HOLD = { base: 0.4, wordsPerSecond: 3.5 } as const;

export function headlineHoldSeconds(words: number): number {
  return HEADLINE_HOLD.base + words / HEADLINE_HOLD.wordsPerSecond;
}

const OVERSHOOT_SAMPLES = 240;

/**
 * How far past its target a curve travels (0.1 = 10%), sampled from the same curve the lowering uses.
 * Springs with a damping ratio under 1, ease-out-back, juicy/anticipate beziers and elastic overshoot;
 * an unparseable spec (an unresolved token, a typo: reported by validation) counts as 0.
 */
export function curveOvershoot(spec: EasingSpec): number {
  let fn: (p: number) => number;

  try {
    fn = parseEasing(spec).fn;
  } catch (error) {
    if (error instanceof EasingError) return 0;

    throw error;
  }

  let peak = 1;

  for (let i = 1; i < OVERSHOOT_SAMPLES; i++) peak = Math.max(peak, fn(i / OVERSHOOT_SAMPLES));

  return Number((peak - 1).toFixed(4));
}

export interface RoleTable {
  /** `role.<name>` → easing spec, ready to merge into the token easings. */
  easings: Record<string, EasingSpec>;
  /** `role.<name>` → seconds, for roles that declare a duration. */
  durations: Record<string, number>;
}

/** Built-ins with the template's roles laid over them, one whole role at a time. */
export function effectiveRoles(
  roles: Partial<Record<string, MotionRoleDefinition>> | undefined
): Record<MotionRoleName, MotionRoleDefinition> {
  const out = { ...BUILTIN_MOTION_ROLES };

  for (const name of MOTION_ROLE_NAMES) {
    const authored = roles?.[name];

    if (authored) out[name] = authored;
  }

  return out;
}

/**
 * The role tokens (`$role.<name>`) against the template's own easings and durations: a role ease may be a
 * `$token`, a role duration a duration token. Unresolvable references stay as written (validation reports them).
 */
export function roleTokens(
  roles: Partial<Record<string, MotionRoleDefinition>> | undefined,
  easings: Record<string, EasingSpec>,
  durations: Record<string, number>
): RoleTable {
  const table: RoleTable = { easings: {}, durations: {} };

  for (const [name, role] of Object.entries(effectiveRoles(roles))) {
    const ease = role.ease;
    table.easings[`role.${name}`] =
      typeof ease === 'string' && ease.startsWith('$') ? (easings[ease.slice(1)] ?? ease) : ease;

    const duration = typeof role.duration === 'string' ? durations[role.duration.slice(1)] : role.duration;

    if (duration !== undefined) table.durations[`role.${name}`] = duration;
  }

  return table;
}
