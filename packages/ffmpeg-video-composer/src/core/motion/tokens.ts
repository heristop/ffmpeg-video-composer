// Motion tokens and the energy dial (docs/plans/motion-system.md §2). The descriptor is resolved once,
// before any lowering: every `$token` becomes its concrete value and every travel distance
// is scaled by `global.motion.energy`, so the presets downstream only ever see plain specs and numbers.

import type { EasingSpec } from './easing';
import type { SpringParams } from './curves';
import { roleTokens, type MotionRoleDefinition } from './roles';
import { applyMotionRoles } from './roles-apply';

export interface MotionTokenSet {
  springs?: Record<string, SpringParams>;
  curves?: Record<string, EasingSpec>;
  durations?: Record<string, number>;
  energy?: number;
  /** Motion roles (roles.ts), referenced as `$role.<name>` and applied to elements that declare `role`. */
  roles?: Partial<Record<string, MotionRoleDefinition>>;
}

/**
 * Built-in tokens, always available, overridable by name in `global.motion`. The curves are the product's
 * own (apps/leclap-web index.css: --ease-smooth, --ease-spring, --ease-out-expo), so a video moves like the
 * app that made it.
 */
export const BUILTIN_MOTION_TOKENS: Required<Omit<MotionTokenSet, 'energy' | 'roles'>> = {
  springs: {
    snappy: { stiffness: 420, damping: 30 },
    gentle: { stiffness: 170, damping: 26 },
    bouncy: { stiffness: 300, damping: 14 },
    wobbly: { stiffness: 180, damping: 12 },
  },
  curves: {
    smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
    juicy: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
    anticipate: 'cubic-bezier(0.68, -0.6, 0.32, 1.6)',
  },
  durations: { stagger: 0.06, micro: 0.18, short: 0.35, base: 0.6, long: 1.1, hold: 2.5 },
};

export const DEFAULT_TRAVEL = 60;

export interface ResolvedTokens {
  easings: Record<string, EasingSpec>;
  durations: Record<string, number>;
  energy: number;
}

function springSpec(spring: SpringParams): string {
  return `spring(${spring.stiffness}, ${spring.damping}, ${spring.mass ?? 1}, ${spring.velocity ?? 0})`;
}

export function resolveTokens(motion: MotionTokenSet | undefined): ResolvedTokens {
  const springs = { ...BUILTIN_MOTION_TOKENS.springs, ...motion?.springs };
  const easings: Record<string, EasingSpec> = { ...BUILTIN_MOTION_TOKENS.curves, ...motion?.curves };

  for (const [name, spring] of Object.entries(springs)) easings[name] = springSpec(spring);

  const durations = { ...BUILTIN_MOTION_TOKENS.durations, ...motion?.durations };
  const roles = roleTokens(motion?.roles, easings, durations);

  return {
    easings: { ...easings, ...roles.easings },
    durations: { ...durations, ...roles.durations },
    energy: motion?.energy ?? 1,
  };
}

/** `$name` → the token's easing spec; anything else is returned unchanged (validation reports misses). */
export function resolveEasingRef(spec: EasingSpec, tokens: ResolvedTokens): EasingSpec {
  if (typeof spec !== 'string' || !spec.startsWith('$')) return spec;

  return tokens.easings[spec.slice(1)] ?? spec;
}

/** `"$base"` → 0.6, `"+$short"` → "+0.35"; numbers and plain relative times pass through. */
export function resolveTimeRef(time: number | string | undefined, tokens: ResolvedTokens): number | string | undefined {
  if (typeof time !== 'string') return time;

  const match = /^(\+?)\$((?:role\.)?[a-z][a-z0-9-]*)$/.exec(time.trim());

  if (!match || !Object.hasOwn(tokens.durations, match[2])) return time;

  const seconds = tokens.durations[match[2]];

  return match[1] ? `+${seconds}` : seconds;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

const TRAVEL_TYPES = new Set(['rise', 'slide-left', 'slide-right']);
const TRAVEL_KEYS = new Set(['reveal', 'exit', 'motion']);

// A reveal/exit/overlay-motion intent with its travel scaled by energy. Bare strings become objects only
// when there is travel to scale, so energy 1 leaves the descriptor untouched.
function scaleTravel(intent: unknown, tokens: ResolvedTokens): unknown {
  const object = typeof intent === 'string' ? { type: intent } : intent;

  if (object === null || typeof object !== 'object' || Array.isArray(object)) return intent;

  const record = object as Record<string, unknown>;
  const resolved = {
    ...record,
    ...(record.easing !== undefined && { easing: resolveEasingRef(record.easing as EasingSpec, tokens) }),
  };

  if (tokens.energy === 1 || !TRAVEL_TYPES.has(String(record.type))) {
    return typeof intent === 'string' ? intent : resolved;
  }

  return { ...resolved, distance: round(((record.distance as number | undefined) ?? DEFAULT_TRAVEL) * tokens.energy) };
}

function resolveKeyframe(key: Record<string, unknown>, axis: string, tokens: ResolvedTokens): Record<string, unknown> {
  const out: Record<string, unknown> = { ...key, t: resolveTimeRef(key.t as number | string | undefined, tokens) };

  if (out.t === undefined) delete out.t;

  if (key.ease !== undefined) out.ease = resolveEasingRef(key.ease as EasingSpec, tokens);

  const relative = typeof key.v === 'string' && (axis === 'x' || axis === 'y');

  if (relative && tokens.energy !== 1) {
    const scaled = round(Number(key.v) * tokens.energy);
    out.v = scaled < 0 ? `${scaled}` : `+${scaled}`;
  }

  return out;
}

function resolveAnimate(animate: unknown, tokens: ResolvedTokens): unknown {
  if (animate === null || typeof animate !== 'object') return animate;

  const tracks: Record<string, unknown> = {};

  for (const [axis, keys] of Object.entries(animate as Record<string, unknown>)) {
    tracks[axis] = Array.isArray(keys)
      ? keys.map((key) => resolveKeyframe(key as Record<string, unknown>, axis, tokens))
      : keys;
  }

  return tracks;
}

function resolveNode(value: unknown, tokens: ResolvedTokens, key: string): unknown {
  if (key === 'animate') return resolveAnimate(value, tokens);

  if (TRAVEL_KEYS.has(key) && !Array.isArray(value)) return scaleTravel(value, tokens);

  if ((key === 'easing' || key === 'ease') && typeof value === 'string') return resolveEasingRef(value, tokens);

  if (Array.isArray(value)) return value.map((item) => resolveNode(item, tokens, ''));

  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};

  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = resolveNode(child, tokens, childKey);
  }

  return out;
}

/**
 * The descriptor with every motion token resolved and every travel scaled by energy. Everything outside
 * `sections` and `global` is returned as-is (meta, partial definitions: partials are expanded into sections
 * before this runs).
 */
export function resolveMotionDescriptor<T extends { meta?: unknown; global?: unknown; sections?: unknown }>(
  descriptor: T
): T {
  const tokens = resolveTokens((descriptor.global as { motion?: MotionTokenSet } | undefined)?.motion);

  return {
    ...descriptor,
    global: resolveNode(descriptor.global, tokens, 'global'),
    sections: resolveNode(applyMotionRoles(descriptor.sections, tokens), tokens, 'sections'),
  };
}
