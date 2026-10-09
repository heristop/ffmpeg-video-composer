export interface StaggerOptions {
  /** Delay added per card within one batch, in ms. */
  step?: number;
  /** Longest delay any card waits, in ms, however long the batch. */
  cap?: number;
}

export interface RevealStaggerOptions extends StaggerOptions {
  /** Runs the batch once the frame's cards have all entered; the next animation frame by default. */
  schedule?: (flush: () => void) => void;
}

/** Hands each card that scrolls into view its entrance delay, staggered against the cards entering with it. */
export interface RevealStagger {
  enter: (element: Element, reveal: (delay: number) => void) => void;
}

interface Box {
  top: number;
  left: number;
}

const STEP = 50;
const CAP = 250;

export const staggerDelay = (slot: number, { step = STEP, cap = CAP }: StaggerOptions = {}): number =>
  Math.min(slot * step, cap);

/** Row by row (tops within a pixel share a row), then left to right. */
export const readingOrder = <T extends Box>(boxes: readonly T[]): T[] =>
  boxes.toSorted((a, b) => Math.round(a.top) - Math.round(b.top) || a.left - b.left);

const nextFrame = (flush: () => void) => {
  requestAnimationFrame(flush);
};

/**
 * Staggers the cards that scroll into view together. The cards entering within one frame form a batch; once
 * the frame is over they take consecutive slots (0, step, 2 × step…) in reading order, since observers
 * report them in no particular order, capped so a tall batch never keeps its last card waiting. The next
 * frame's cards start a fresh batch at 0.
 */
export const createRevealStagger = ({
  step = STEP,
  cap = CAP,
  schedule = nextFrame,
}: RevealStaggerOptions = {}): RevealStagger => {
  let batch: Array<Box & { reveal: (delay: number) => void }> = [];

  const flush = () => {
    const entered = readingOrder(batch);

    batch = [];
    for (const [slot, { reveal }] of entered.entries()) {
      reveal(staggerDelay(slot, { step, cap }));
    }
  };

  const enter = (element: Element, reveal: (delay: number) => void) => {
    const { top, left } = element.getBoundingClientRect();

    if (batch.length === 0) schedule(flush);
    batch.push({ top, left, reveal });
  };

  return { enter };
};
