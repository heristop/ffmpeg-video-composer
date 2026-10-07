// The FFmpeg commands behind frame snapshots, as argv arrays: grab one frame (optionally shading a
// platform's UI zones and cropping a region), and tile frames into a labelled contact sheet. Pure string
// building, so the exact filtergraphs are unit-tested; services/snapshot-node.ts runs them.

import type { SafeZone } from '../core/platforms';

/** A region of the frame, in fractions of its width/height (0..1) or, when any value is above 1, pixels. */
export interface SnapshotZoom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetLayout {
  cols: number;
  rows: number;
  /** Width of one tile in pixels (default 480). */
  tileWidth?: number;
  /** Height of one tile: frames of another aspect are letterboxed into it. Default: each frame's own. */
  tileHeight?: number;
}

export interface SheetInput {
  path: string;
  label: string;
}

export const DEFAULT_TILE_WIDTH = 480;
const SAFE_SHADE = 'red@0.35';
const SHEET_BACKGROUND = '0x111111';
const SHEET_PADDING = 6;

function fixed(value: number): string {
  return Number(value.toFixed(4)).toString();
}

/** One translucent box per edge the platform's UI covers. */
export function safeZoneFilters(safe: SafeZone): string[] {
  const boxes = [
    { edge: safe.top, box: (f: string) => `x=0:y=0:w=iw:h=ih*${f}` },
    { edge: safe.bottom, box: (f: string) => `x=0:y=ih*(1-${f}):w=iw:h=ih*${f}` },
    { edge: safe.left, box: (f: string) => `x=0:y=0:w=iw*${f}:h=ih` },
    { edge: safe.right, box: (f: string) => `x=iw*(1-${f}):y=0:w=iw*${f}:h=ih` },
  ];

  return boxes
    .filter(({ edge }) => edge > 0)
    .map(({ edge, box }) => `drawbox=${box(fixed(edge))}:color=${SAFE_SHADE}:t=fill`);
}

/** Crop to a region given in fractions of the frame (all values ≤ 1) or in pixels. */
export function zoomFilter(zoom: SnapshotZoom): string {
  const values = [zoom.x, zoom.y, zoom.w, zoom.h];

  if (values.some((value) => !Number.isFinite(value) || value < 0) || zoom.w === 0 || zoom.h === 0) {
    throw new Error('zoom needs finite, non-negative x/y and positive w/h');
  }

  if (values.every((value) => value <= 1)) {
    return `crop=w=iw*${fixed(zoom.w)}:h=ih*${fixed(zoom.h)}:x=iw*${fixed(zoom.x)}:y=ih*${fixed(zoom.y)}`;
  }

  return `crop=w=${Math.round(zoom.w)}:h=${Math.round(zoom.h)}:x=${Math.round(zoom.x)}:y=${Math.round(zoom.y)}`;
}

/** Grab the frame at `time` (accurate input seek: decodes up to it) as a PNG. */
export function frameArgs(video: string, time: number, out: string, filters: readonly string[] = []): string[] {
  return [
    '-y',
    '-ss',
    time.toFixed(3),
    '-i',
    video,
    '-frames:v',
    '1',
    ...(filters.length > 0 ? ['-vf', filters.join(',')] : []),
    '-update',
    '1',
    out,
  ];
}

/** Label text that survives the filtergraph: no quotes, backslashes or control characters. */
export function sanitizeLabel(label: string): string {
  return label
    .replaceAll(/['"\\\n\r\t]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function labelFilter(label: string, tileWidth: number, fontfile: string | undefined): string {
  const size = Math.max(14, Math.round(tileWidth / 26));
  const font = fontfile && !/['\\]/.test(fontfile) ? `fontfile='${fontfile.replaceAll(':', String.raw`\:`)}':` : '';

  return (
    `drawtext=${font}expansion=none:text='${sanitizeLabel(label).replaceAll(':', String.raw`\:`)}'` +
    `:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6:x=8:y=h-th-12`
  );
}

function fit(width: number, height: number | undefined): string {
  if (height === undefined) return `scale=${width}:-2`;

  return (
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:-1:-1:color=${SHEET_BACKGROUND}`
  );
}

/** Every tile scaled to one width, labelled, concatenated and tiled into one image. */
export function sheetFilter(inputs: readonly SheetInput[], layout: SheetLayout, fontfile?: string | false): string {
  const tileWidth = layout.tileWidth ?? DEFAULT_TILE_WIDTH;
  const chains = inputs.map((input, i) => {
    const label = fontfile === false ? '' : `,${labelFilter(input.label, tileWidth, fontfile)}`;

    return `[${i}:v]${fit(tileWidth, layout.tileHeight)},setsar=1,format=rgb24${label}[t${i}]`;
  });
  const joined = inputs.map((_, i) => `[t${i}]`).join('');
  const tile =
    `tile=${layout.cols}x${layout.rows}:padding=${SHEET_PADDING}:margin=${SHEET_PADDING}` +
    `:color=${SHEET_BACKGROUND}`;

  return `${chains.join(';')};${joined}concat=n=${inputs.length}:v=1:a=0,${tile}[sheet]`;
}

/**
 * Tile up to cols×rows frames into a contact sheet PNG. `fontfile` names the label font; `false` drops
 * the labels (an FFmpeg without drawtext); undefined lets drawtext pick its default font.
 */
export function sheetArgs(
  inputs: readonly SheetInput[],
  layout: SheetLayout,
  out: string,
  fontfile?: string | false
): string[] {
  if (inputs.length === 0 || inputs.length > layout.cols * layout.rows) {
    throw new Error(`a ${layout.cols}x${layout.rows} sheet holds 1..${layout.cols * layout.rows} frames`);
  }

  return [
    '-y',
    ...inputs.flatMap((input) => ['-i', input.path]),
    '-filter_complex',
    sheetFilter(inputs, layout, fontfile),
    '-map',
    '[sheet]',
    '-frames:v',
    '1',
    '-update',
    '1',
    out,
  ];
}

/** "3x2" → { cols: 3, rows: 2 }; null for anything else. */
export function parseSheet(text: string): SheetLayout | null {
  const match = /^(\d{1,2})x(\d{1,2})$/i.exec(text.trim());

  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) return null;

  return { cols: Number(match[1]), rows: Number(match[2]) };
}

/** The argv as one command string for AbstractFFmpeg.execute (every argument quoted). */
export function toCommand(args: readonly string[]): string {
  return args.map((arg) => (arg.startsWith('-') && !arg.includes(' ') ? arg : `"${arg}"`)).join(' ');
}
