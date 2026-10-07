// Sub-pixel zoom and pan on whole-pixel filters.
//
// `zoompan` crops a whole-pixel window (x, y, w, h are integers; x and y even in 4:2:0) and rescales it,
// so a slow zoom or pan moves the picture in visible whole-pixel steps: the content holds still for a
// frame or three, then jumps (a push-in reads at a fraction of the frame rate). Supersampling only
// shrinks the step, at a quadratic cost.
//
// Here the frame is first scaled to S×T (`scale`, eval=frame), then `zoompan` crops w×h at (x, y) and
// scales that back to W×H. The zoom actually rendered is S/w across and T/h down, and the pan is set by
// x and y: four integers per frame, chosen together so that both the ratio and the offset land within a
// few hundredths of a pixel of the exact move. Each frame runs a small best-fit search inside the FFmpeg
// expressions (`while`, `st`/`ld`): over crop widths w from W to W+SPAN (plus a few large rasters a
// near-1 zoom needs to place its centre exactly), keep the pair whose geometry is closest. `scale` runs
// it to size the frame, `zoompan` repeats the identical search to find w, then reads S and T back from
// its input size. Both stages work in 4:4:4 so the crop offset is free of the chroma grid.
//
// Both stages read the same clock: `setpts` restamps the frames as N/fps first (zoompan restamps its
// output on the frame clock anyway), so `t` in scale and `it` in zoompan are the frame index over fps.
// Registers: 0 zoom, 1 pan (input px), 2 best score, 3 best w, 4 loop index, 5 candidate, 6 S or T,
// 7 offset or 1/zoom, 8 score, 9 best S or h. Filters: setpts, scale, format, zoompan (all on-device).
//
// Rest over-scan. Near zoom 1 the integer rasters run out: a zoom of 1+ε with an exactly centred crop
// needs S-w = 2 on a raster w = 2/ε, so below 1+1/max(W,H) (the largest raster searched) nothing between
// 1 and that step can be drawn: an eased move leaving or reaching zoom 1 held still for several frames,
// then jumped by half a pixel. So a moving zoom never rests at exactly 1 but at 1+REST (REST = 3/max(W,H),
// 1.5 px per edge on the long side), inside the S-w = 4 family of rasters about 4/3·max(W,H) wide, which
// resolves every frame's step to a thousandth of a pixel; resting there rather than at the bottom of a
// family also keeps the first frames of a move on the same raster (no change of resampling softness).
// The over-scan fades out as z + REST·(1-(z-1)/FADE)² below 1+FADE (C¹, monotonic, never under 1+REST),
// so zooms from 1+FADE up render exactly as requested. A constant zoom is left as it is, and a stream that
// hands over to the untouched picture (`identityAtRest`) keeps zoom 1 as the identity.

import { fmt } from './hermite';

export interface ZoomFrame {
  width: number;
  height: number;
  fps: number;
  /**
   * Render zoom 1 as the untouched picture (no rest over-scan), for a stream that cuts or overlays back to
   * the source; frames within 1/max(width, height) of zoom 1 then hold still.
   */
  identityAtRest?: boolean;
}

/** Placeholder for the time in seconds inside ZoomMove expressions; each stage substitutes its own clock. */
export const ZOOM_TIME = '@t';

/** Expressions in ZOOM_TIME: zoom factor (≥1) and pan of the view centre in output px (+x moves right). */
export interface ZoomMove {
  zoom: string;
  panX?: string;
  panY?: string;
}

function at(expr: string | undefined, time: string): string {
  return expr === undefined ? '0' : expr.replaceAll(ZOOM_TIME, time);
}

/** Rest over-scan, in long-side pixels across the frame (see the header). */
const REST = 3;
/** Zooms from 1+FADE up render exactly; below, the rest over-scan fades in. */
const FADE = 0.05;

/** The rest over-scan applied to the zoom in ld(0), or '' where it does not apply. */
function rest(move: ZoomMove, frame: ZoomFrame): string {
  if (frame.identityAtRest || Number.isFinite(Number(move.zoom))) return '';

  return `;st(0,ld(0)+${fmt(REST / Math.max(frame.width, frame.height))}*pow(max(0,1-(ld(0)-1)/${FADE}),2))`;
}

/** `st(0,…)`: the requested zoom at `time`, clamped to 1, plus the rest over-scan where it applies. */
function level(move: ZoomMove, frame: ZoomFrame, time: string): string {
  return `st(0,max(1,${at(move.zoom, time)}))${rest(move, frame)}`;
}

/** Crop widths searched above the output width: more candidates fit closer, at a small raster cost. */
const SPAN = 192;
/** Extra large-raster candidates for zooms within a fraction of a percent of 1. */
const NEAR_ONE = 8;
/** Tie-break towards the smaller raster, in pixels of error per output width of extra raster. */
const RASTER_COST = 0.001;

// Score of the candidate width in ld(5): |offset error| + half the edge error from the ratio, in output px.
function scoreX(W: number, S = 'round(ld(0)*ld(5))'): string {
  return (
    `st(6,${S});st(7,(${fmt(W / 2)}+ld(1))*ld(6)/${W}-ld(5)/2);` +
    `st(8,abs(round(ld(7))-ld(7))*${W}/ld(5)+abs(ld(6)/ld(5)-ld(0))*${fmt(W / 4)}+${RASTER_COST}*ld(5)/${W});` +
    `if(lt(ld(8),ld(2)),st(2,ld(8))+st(3,ld(5))+st(9,ld(6)))`
  );
}

/** Leaves the best crop width in ld(3) and its scaled width S in ld(9). */
function searchX(move: ZoomMove, frame: ZoomFrame, time: string): string {
  const { width: W, height: H } = frame;
  const pan = at(move.panX, time);
  const bound = 2 * Math.max(W, H);

  return (
    `${level(move, frame, time)};st(1,(${pan})/ld(0));st(2,1e9);st(5,${W});${scoreX(W, 'ld(5)')};` +
    `st(4,0);while(lte(ld(4),${SPAN}),st(5,${W}+ld(4));${scoreX(W)};st(4,ld(4)+1));` +
    `st(4,1);while(lte(ld(4),${NEAR_ONE}),st(5,round(2*ld(4)/max(ld(0)-1,1e-9)));` +
    `if(between(ld(5),${W},${bound}),${scoreX(W)});st(4,ld(4)+1))`
  );
}

// Score of the candidate height in ld(5), given 1/zoom in ld(7): zoompan crops h = floor(T/zoom).
function scoreY(H: number): string {
  return (
    `st(9,floor(ld(5)*ld(7)));st(8,(${fmt(H / 2)}+ld(1))*ld(5)/${H}-ld(9)/2);` +
    `st(3,abs(round(ld(8))-ld(8))*${H}/ld(9)+abs(ld(5)/ld(9)-ld(0))*${fmt(H / 4)}+${RASTER_COST}*ld(5)/${H});` +
    `if(lt(ld(3),ld(2)),st(2,ld(3))+st(6,ld(5)))`
  );
}

/** After searchX: the best scaled height T. */
function searchY(move: ZoomMove, frame: ZoomFrame, time: string): string {
  const { width: W, height: H } = frame;
  const pan = at(move.panY, time);
  const bound = 2 * Math.max(W, H);
  const span = Math.round((SPAN * H) / W);
  const near = `if(between(ld(5),${H},${bound}),${scoreY(H)})`;

  return (
    `st(1,(${pan})/ld(0));st(7,1/max(1,ld(9)/(ld(3)+0.5)));st(2,1e9);st(6,${H});` +
    `st(4,0);while(lte(ld(4),${span}),st(5,round(ld(0)*${H})+ld(4));${scoreY(H)};st(4,ld(4)+1));` +
    `st(4,1);while(lte(ld(4),${NEAR_ONE}),st(5,round(2*ld(4)*ld(0)/max(ld(0)-1,1e-9)));` +
    `${near};st(5,ld(5)+1);${near};st(4,ld(4)+1));ld(6)`
  );
}

// zoompan's own crop offset for the axis: the view centre (plus pan) in the scaled frame, minus half
// the crop it derives from `zoom`; +0.25 keeps the whole-pixel truncation off a rounding edge. `zoom` is
// the requested zoom after `prefix` (which stores it in ld(0) when the rest over-scan applies).
function offset(size: number, input: string, pan: string, [prefix, zoom]: [string, string]): string {
  return `${prefix}round((${fmt(size / 2)}+(${pan})/${zoom})*${input}/${size}-floor(${input}*(1/zoom))/2)+0.25`;
}

/**
 * The filters for an exact zoom/pan at the output frame rate, replacing a pre-upscale + `zoompan`. The
 * input is any W×H stream; the output is W×H at `fps` in yuv420p, one frame per input frame.
 */
export function exactZoomFilters(move: ZoomMove, frame: ZoomFrame): string[] {
  const { width: W, height: H, fps } = frame;
  const zoom: [string, string] = rest(move, frame)
    ? [`${level(move, frame, 'it')};`, 'ld(0)']
    : ['', `(max(1,${at(move.zoom, 'it')}))`];
  const x = offset(W, 'iw', at(move.panX, 'it'), zoom);
  const y = offset(H, 'ih', at(move.panY, 'it'), zoom);
  const searchW = searchX(move, frame, 't');

  return [
    `setpts=N/(${fps}*TB)`,
    `scale=w='${searchW};ld(9)':h='${searchW};${searchY(move, frame, 't')}':eval=frame:flags=bicubic`,
    'format=yuv444p',
    `zoompan=z='${searchX(move, frame, 'it')};iw/(ld(3)+0.5)':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${fps}`,
    'format=yuv420p',
  ];
}

/** exactZoomFilters as filter descriptors ({ type, value }, a Filter). */
export function exactZoomFilterObjects(move: ZoomMove, frame: ZoomFrame): { type: string; value: string }[] {
  return exactZoomFilters(move, frame).map((filter) => {
    const split = filter.indexOf('=');

    return { type: filter.slice(0, split), value: filter.slice(split + 1) };
  });
}
