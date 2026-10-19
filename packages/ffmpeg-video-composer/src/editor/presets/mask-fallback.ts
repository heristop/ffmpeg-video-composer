// What a mask needs alphamerge for, and what draws without it: the build note (presets/layer-masks.ts) and the
// render-free advisory (services/mask-advisories.ts) share this wording.

export function maskFallback(mask: { layer?: unknown; invert?: unknown }): { need: string; outcome: string } {
  if (mask.layer) return { need: 'a track matte', outcome: 'both layers draw unmasked' };

  if (mask.invert) return { need: 'an inverted mask', outcome: 'it draws unmasked' };

  return { need: 'a shape mask', outcome: "it is cut to the mask's resting box" };
}
