// When an element's entrance has landed, from what is known before rendering: a kinetic block's last
// unit arrives after its last stagger rank plus one unit duration (laid out with the bundled font
// metrics, at the real frame size and text), a graphic after its duration, a drawtext after its reveal.

import type { KineticBlock } from '../../schemas/kinetic.schemas';
import type { Graphic } from '../../schemas/graphics.schemas';
import type { Reveal } from '../descriptor-text';
import { kineticEntranceSpan } from '../kinetic/fit';
import { graphicDuration } from '../../editor/presets/graphics';
import { REVEAL_DEFAULT_DELAY, revealSpan } from '../../editor/presets/text';
import type { ElementEntry } from './fields';

export interface TimingFrame {
  width: number;
  height: number;
  fps: number;
  energy: number;
}

export interface SpanContext {
  frame: TimingFrame;
  /** Section length when known. */
  duration: number | undefined;
  /** The final text of a kinetic block (locale, variables, fields, case). */
  text: (text: Record<string, string | undefined>) => string;
}

const KINETIC_DEFAULT_DELAY = 0.2;

function revealOf(entry: ElementEntry): Reveal | undefined {
  return entry.node.reveal as Reveal | undefined;
}

/** The start an element takes when its start field is omitted. */
export function defaultStart(entry: ElementEntry): number {
  if (entry.kind === 'kinetic') return KINETIC_DEFAULT_DELAY;

  if (entry.kind === 'graphic') return 0;

  const reveal = revealOf(entry);

  return reveal === undefined || reveal === 'none' || (typeof reveal === 'object' && reveal.type === 'none')
    ? 0
    : REVEAL_DEFAULT_DELAY;
}

/** Seconds from the element's start until its entrance has landed. */
export function entranceSpan(entry: ElementEntry, ctx: SpanContext): number {
  if (entry.kind === 'graphic') return graphicDuration(entry.node as Graphic, ctx.frame);

  if (entry.kind === 'drawtext') return revealSpan(revealOf(entry));

  const block = entry.node as KineticBlock;
  const frame = { ...ctx.frame, duration: ctx.duration ?? 0, seed: 0 };

  return kineticEntranceSpan(block, frame, block.preset === 'counter' ? '' : ctx.text(block.text));
}
