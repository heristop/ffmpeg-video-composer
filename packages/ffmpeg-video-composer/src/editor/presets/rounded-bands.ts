// A rounded rectangle as drawbox bands. Kept apart from the PNG panel generator (rounded-panel.ts):
// lower thirds draw these bands, and they are lowered during validation, so the browser entry's eager
// load carries this sampling but not the PNG encoder, which only the compile stages.

/** One horizontal band of a rounded rectangle and how far its ends are pulled in by the corners. */
export interface RoundedBand {
  /** Top of the band, from the top of the rectangle. */
  y: number;
  h: number;
  /** Horizontal inset of both ends at the band's middle row. */
  inset: number;
}

/**
 * A rounded rectangle as non-overlapping horizontal bands (the same corner arc the PNG panel rasterizes,
 * sampled per band): `rows` bands per corner, then one straight band between them. Lets drawbox, which
 * only fills rectangles, draw a rounded panel or pill with translucent fills that never double up.
 */
export function roundedBands(height: number, radius: number, rows: number): RoundedBand[] {
  const r = Math.max(0, Math.min(height / 2, radius));
  const count = r < 1 ? 0 : Math.max(1, Math.floor(rows));
  const step = count === 0 ? 0 : r / count;
  const top = Array.from({ length: count }, (_, i) => {
    const dy = r - (i + 0.5) * step;

    return { y: i * step, h: step, inset: r - Math.sqrt(r * r - dy * dy) };
  });
  const middle = height - 2 * r >= 0.5 ? [{ y: r, h: height - 2 * r, inset: 0 }] : [];
  const bottom = top.map((_, i) => top[top.length - 1 - i]).map((band) => ({ ...band, y: height - band.y - band.h }));

  return [...top, ...middle, ...bottom];
}
