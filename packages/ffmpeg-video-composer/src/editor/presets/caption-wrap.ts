// Opt-in wrapping for the caption sugar (`caption.wrap` / `caption.fit`): the resolved copy is measured
// with the bundled font, optionally shrunk until it fits `fit.maxLines`, wrapped greedy or balanced, and
// drawn one drawtext per line on a shared baseline, stacked from the caption's anchor. Without either
// field the caption stays a single drawtext (captions.ts), byte for byte.

import type { Filter } from '@/core/types';
import type { Caption } from '../../schemas/section.schemas';
import { fmt } from '@/core/motion/hermite';
import { resolvePlatform } from '@/core/platforms';
import { fitCaption, wrapWords, type WrapMode } from '@/core/captions/wrap';
import { CAPTION_BASELINE } from '@/core/captions/place';
import { CAPTION_ALIGN_MARGIN, captionAnchorY, platformCaptionOffset } from './caption-layout';
import { applyReveal, applyTextEffect } from './text';
import type { SugarContext } from './sugar-context';

const LINE_HEIGHT = 1.25;
const DEFAULT_FIT_LINES = 2;
const MIN_SIZE_RATIO = 0.75;

export interface CaptionBase {
  /** The drawtext values every line shares (font, colour, box…), without text / y. */
  values: Record<string, unknown>;
  x: string;
  size: number;
}

type WrapContext = Pick<SugarContext, 'scale' | 'platform' | 'motion'>;

function frameOf(ctx: WrapContext): { width: number; height: number } | null {
  const [width, height] = ctx.scale.split(':').map(Number);

  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}

function maxWidth(width: number, platform: string | undefined): number {
  const safe = resolvePlatform(platform)?.safe;

  return safe ? width * (1 - safe.left - safe.right) : width - 2 * CAPTION_ALIGN_MARGIN;
}

function lines(caption: Caption, words: string[], font: string, size: number, width: number) {
  const mode: WrapMode = caption.wrap ?? 'greedy';

  if (!caption.fit) {
    const wrapped = wrapWords(words, font, size, width, mode);

    return wrapped && { size, lines: wrapped };
  }

  const minSize = caption.fit.minSize ?? Math.round(size * MIN_SIZE_RATIO);
  const maxLines = caption.fit.maxLines ?? DEFAULT_FIT_LINES;

  return fitCaption({ words, font, size, minSize, maxWidth: width, maxLines, mode });
}

// Top of the block: the caption's anchor (a default caption on a platform clears its bottom UI).
function blockTop(caption: Caption, ctx: WrapContext, height: number, block: number): number {
  const anchor = captionAnchorY(caption.position);
  const bottom = caption.position === undefined ? resolvePlatform(ctx.platform)?.safe.bottom : undefined;

  if (bottom !== undefined) return height - platformCaptionOffset(height, bottom) - block;

  if (anchor.edge === 'top') return anchor.offset;

  return anchor.edge === 'center' ? (height - block) / 2 : height - anchor.offset - block;
}

/** The wrapped caption's filters, or null when it can't be measured (font not bundled, no context). */
export function wrappedCaptionFilters(
  caption: Caption,
  ctx: WrapContext | undefined,
  base: CaptionBase
): Filter[] | null {
  const frame = ctx && frameOf(ctx);
  const font = base.values.fontfile;

  if (!ctx?.motion || !frame || typeof font !== 'string') return null;

  const words = ctx.motion.resolveText(caption.text).split(/\s+/).filter(Boolean);
  const laid = lines(caption, words, font, base.size, maxWidth(frame.width, ctx.platform));

  if (!laid || words.length === 0) return null;

  const lineHeight = laid.size * LINE_HEIGHT;
  const top = blockTop(caption, ctx, frame.height, laid.lines.length * lineHeight);
  const inset = (lineHeight - laid.size) / 2;

  return laid.lines.map((line, index) => {
    const y = `${fmt(top + index * lineHeight + inset + laid.size * CAPTION_BASELINE)}-max_glyph_a`;
    const values: Record<string, unknown> = {
      ...base.values,
      text: line.join(' '),
      x: base.x,
      y: `'${y}'`,
      fontsize: laid.size,
    };

    applyTextEffect(values, caption.effect);
    applyReveal(values, caption.reveal, { x: base.x, y });

    return { type: 'drawtext', values };
  });
}
