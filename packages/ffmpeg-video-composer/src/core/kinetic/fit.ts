// Fits a kinetic block to the unit budget and measures its entrance. Shared by the lowering
// (editor/presets/kinetic.ts) and the time-reference pass, which needs to know when a block has landed
// (`"title.end"`) without drawing it. Pure.

import type { KineticBlock } from '../../schemas/kinetic.schemas';
import { needsShaping } from '../text-scripts';
import { layoutKinetic, type KineticUnit, type Layout } from './layout';
import { resolveKinetic, staggerRanks, type KineticFrame, type ResolvedKinetic } from './resolve';
import { wrapText } from '../captions/wrap';

/** Upper bound of independently animated units per block (each is a drawtext). */
export const MAX_KINETIC_UNITS = 64;
const COARSER: Record<KineticUnit, KineticUnit> = { glyph: 'word', word: 'line', line: 'line' };
/** Width guess (in em per character) for a line no table can measure; only drives box estimates. */
const UNMEASURED_EM = 0.55;

export interface FittedLayout {
  layout: Layout;
  unit: KineticUnit;
  /**
   * Lines are placed by drawtext's own `text_w` rather than the measured width: the copy is shaped
   * (joined Arabic, reordered RTL), so isolated-glyph advances only approximate it, or it can't be
   * measured at all (font not bundled, glyph outside the advance table).
   */
  anchored: boolean;
}

// Whole lines on explicit breaks only, for line units the advance table can't measure: drawtext still
// draws (and shapes) them; widths are a guess used for box estimates, never for placement.
function unmeasuredLines(settings: ResolvedKinetic, text: string): Layout {
  const lines = text.split('\n').map((line, index) => {
    const width = line.length * settings.size * UNMEASURED_EM;
    const x = { left: settings.x, center: settings.x - width / 2, right: settings.x - width }[settings.align];

    return { text: line, width, x, y: index * settings.lineHeight };
  });
  const pieces = lines.map((line, index) => ({ ...line, line: index, word: index }));

  return { pieces, lines, height: lines.length * settings.lineHeight };
}

/** The block laid out at its unit, stepping up to coarser units until it fits the budget. */
export function layoutWithin(settings: ResolvedKinetic, source: string): FittedLayout | null {
  let unit = settings.unit;
  const shaped = needsShaping(source);
  // Balanced lines are pre-broken with explicit newlines; each already fits, so layout keeps them.
  const balanced =
    settings.wrap === 'balanced' ? wrapText(source, settings.font, settings.size, settings.maxWidth, 'balanced') : null;
  const text = balanced ? balanced.join('\n') : source;

  for (;;) {
    const layout = layoutKinetic({ ...settings, unit, text, y: 0 });

    if (!layout && unit === 'line') return { layout: unmeasuredLines(settings, text), unit, anchored: true };

    if (!layout) return null;

    if (layout.pieces.length <= MAX_KINETIC_UNITS || unit === 'line') return { layout, unit, anchored: shaped };

    unit = COARSER[unit];
  }
}

/**
 * Seconds from the block's first move to its last unit landing: the last stagger rank plus one unit
 * duration (a counter rolls for one duration). 0 when there is nothing to draw.
 */
export function kineticEntranceSpan(block: KineticBlock, frame: KineticFrame, text: string): number {
  const settings = resolveKinetic({ ...block, delay: 0 }, frame, text);

  if (block.preset === 'counter') return settings.duration;

  const laid = text.trim() ? layoutWithin(settings, text) : null;

  if (!laid) return 0;

  // The last rank does not depend on the seed: a random order is still a permutation.
  const ranks = staggerRanks(laid.layout.pieces, block.order, 0);

  return Math.max(0, ...ranks) * settings.stagger + settings.duration;
}
