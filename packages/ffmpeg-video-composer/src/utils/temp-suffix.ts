// The one sanctioned use of the wall clock in the render path: unique names for scratch files, so two
// compiles sharing a temp dir never collide. The `_u<counter>-<ms>` shape is what the render manifest
// normalizes away (core/determinism/manifest.ts), keeping the graph digest independent of when a
// render ran. Never feed this into anything that changes pixels or samples.
let counter = 0;

export function uniqueTempSuffix(): string {
  counter += 1;

  return `u${counter}-${Date.now()}`;
}
