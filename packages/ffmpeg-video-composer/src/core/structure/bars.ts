// Letterbox and pillarbox bars: near-black, uniform rows or columns on opposite edges of every frame of
// the clip. Cropped before the analysis, or they dilute the frame differences (cuts inside the picture
// go unseen) and their hard edges pull the anchor onto the frame's border.

import { lumaOf } from '../style/texture';
import type { StyleFrame } from '../style/types';

// Mean 8-bit luma at or under which a line can be a bar, and the spread a bar line tolerates (codec noise).
const BAR_LUMA = 40;
const BAR_SPREAD = 16;
// At most this share of the frame per side: a 9:16 picture pillarboxed in 16:9 leaves ~34% on each side.
const MAX_BAR_SHARE = 0.4;

interface Area {
  left: number;
  top: number;
  width: number;
  height: number;
}

function isBarLine(luma: Uint8Array, start: number, step: number, count: number): boolean {
  let min = 255;
  let max = 0;

  for (let i = 0; i < count; i++) {
    const value = luma[start + i * step];
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return max <= BAR_LUMA && max - min <= BAR_SPREAD;
}

// How many lines from one edge are bars in every frame (capped at MAX_BAR_SHARE of `lines`).
function barDepth(isBar: (line: number) => boolean, lines: number, fromEnd: boolean): number {
  const cap = Math.floor(lines * MAX_BAR_SHARE);
  let depth = 0;

  while (depth < cap && isBar(fromEnd ? lines - 1 - depth : depth)) depth++;

  return depth;
}

// Lines of slack between the two bars of a pair (codec rounding), or this share of the deeper one.
const PAIR_SLACK = 2;
const PAIR_SHARE = 0.25;

// Bars come in even pairs: a single dark edge, or uneven dark margins, are content (a night sky, a
// subject off-centre on a black ground), not a letterbox.
function paired(start: number, end: number): [number, number] {
  const even = Math.abs(start - end) <= Math.max(PAIR_SLACK, PAIR_SHARE * Math.max(start, end));

  return start > 0 && end > 0 && even ? [start, end] : [0, 0];
}

function activeArea(frames: readonly StyleFrame[]): Area {
  const { width, height } = frames[0];
  const lumas = frames.map(lumaOf);
  function rowIsBar(y: number): boolean {
    return lumas.every((luma) => isBarLine(luma, y * width, 1, width));
  }

  function columnIsBar(x: number): boolean {
    return lumas.every((luma) => isBarLine(luma, x, width, height));
  }

  const [top, bottom] = paired(barDepth(rowIsBar, height, false), barDepth(rowIsBar, height, true));
  const [left, right] = paired(barDepth(columnIsBar, width, false), barDepth(columnIsBar, width, true));

  return { left, top, width: width - left - right, height: height - top - bottom };
}

function crop(frame: StyleFrame, area: Area): StyleFrame {
  const channels = frame.channels ?? 3;
  const data = new Uint8Array(area.width * area.height * channels);

  for (let y = 0; y < area.height; y++) {
    for (let x = 0; x < area.width * channels; x++) {
      data[y * area.width * channels + x] = frame.data[((area.top + y) * frame.width + area.left) * channels + x];
    }
  }

  return { ...frame, data, width: area.width, height: area.height };
}

/** The frames cropped to the picture inside letterbox or pillarbox bars (untouched when there are none). */
export function cropBars(frames: readonly StyleFrame[]): StyleFrame[] {
  const sized = frames.length > 0 && frames.every((f) => f.width === frames[0].width && f.height === frames[0].height);

  if (!sized) return [...frames];

  const area = activeArea(frames);

  if (area.width === frames[0].width && area.height === frames[0].height) return [...frames];

  return frames.map((frame) => crop(frame, area));
}
