// Lowering-side guards for time fields that accept time references at authoring time. The compile-time
// pass (core/timing/resolve.ts) has already turned every reference into seconds, so these only narrow the
// type; a string reaching them is an engine bug and fails loudly instead of rendering a wrong frame.

const TIME_KEYS = ['delay', 'after', 'at', 'until'] as const;

type TimeKey = (typeof TIME_KEYS)[number];

/** `T` with its time fields narrowed to seconds. */
export type Resolved<T> = T extends object ? { [K in keyof T]: K extends TimeKey ? Exclude<T[K], string> : T[K] } : T;

/** A time field after the time-reference pass: seconds (or absent). */
export function seconds(value: number | string | undefined): number | undefined {
  if (typeof value === 'string') throw new Error(`time reference "${value}" was not resolved before lowering`);

  return value;
}

/** An object (kinetic block, graphic, reveal...) whose time fields are seconds after the pass. */
export function resolvedTimes<T>(value: T): Resolved<T> {
  if (value !== null && typeof value === 'object') {
    for (const key of TIME_KEYS) seconds((value as Record<string, number | string | undefined>)[key]);
  }

  return value as Resolved<T>;
}
