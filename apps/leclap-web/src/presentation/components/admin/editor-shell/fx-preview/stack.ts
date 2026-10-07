// The preview's paint order. The engine composites a section's fx layers in authored order, and the effects
// built from the picture (glass, resolve, bloom) filter whatever was composited before them. The browser draws
// those as CSS backdrop filters on a DOM surface, which only see what sits behind them in the DOM; so the
// painters are cut into slots: a canvas for each run of canvas painters, and a surface between runs. A surface
// then filters the canvases under it, and the painters authored after it draw on a canvas above it.
import type { FxPainter } from './painter';

/** One DOM layer of the preview, bottom to top: a canvas shared by a run of painters, or one surface. */
export type Slot = { kind: 'canvas'; members: number[] } | { kind: 'surface'; member: number };

/**
 * The slots for `painters` (indices into it), in authored order. A painter's own canvas drawing goes above
 * its surface. The stack always ends with a canvas: the target outlines are drawn there, over everything.
 */
export function stackOf(painters: readonly Pick<FxPainter, 'paint' | 'surface'>[]): Slot[] {
  const slots: Slot[] = [];

  for (const [member, painter] of painters.entries()) {
    if (painter.surface) slots.push({ kind: 'surface', member });

    if (painter.paint) addToCanvas(slots, member);
  }

  if (slots.at(-1)?.kind !== 'canvas') slots.push({ kind: 'canvas', members: [] });

  return slots;
}

function addToCanvas(slots: Slot[], member: number): void {
  const last = slots.at(-1);

  if (last?.kind === 'canvas') {
    last.members.push(member);

    return;
  }

  slots.push({ kind: 'canvas', members: [member] });
}
