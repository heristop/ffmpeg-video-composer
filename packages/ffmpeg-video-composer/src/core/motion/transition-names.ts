// The designed transitions' names and default curve: what the schemas and the validator need, kept apart from
// their filter graphs (transitions.ts) so validating a template never loads the lowering.

export const DESIGNED_TRANSITIONS = [
  'push-left',
  'push-right',
  'push-up',
  'push-down',
  'swipe-left',
  'swipe-right',
  'zoom-through',
  'iris',
  'whip-left',
  'whip-right',
  'whip-up',
  'whip-down',
] as const;

export type DesignedTransition = (typeof DESIGNED_TRANSITIONS)[number];

/** Default transition curve: a symmetric, Apple-like ease-in-out. */
export const DEFAULT_TRANSITION_EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';

export function isDesignedTransition(type: string): type is DesignedTransition {
  return (DESIGNED_TRANSITIONS as readonly string[]).includes(type);
}
