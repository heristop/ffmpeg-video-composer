// Virtual camera lowering (docs/plans/motion-system.md §4.2). The frame is framed by an exact
// sub-pixel zoom/pan on the output frame clock (zoom-exact.ts: no whole-pixel stepping), then rolled by
// `rotate`. Every move is a P1 track or closed-form term, so it is deterministic; the frame is
// over-scanned just enough that pans, shake and roll never reveal an edge.

import type { Camera } from '../../schemas/camera.schemas';
import { seededRandom } from '../determinism/hash';
import { fmt } from './hermite';
import { trackExpr, type TrackKey } from './tracks';
import { seconds } from '../timing/seconds';
import { exactZoomFilters, ZOOM_TIME, type ZoomMove } from './zoom-exact';

export interface CameraFrame {
  width: number;
  height: number;
  fps: number;
  /** Section length in seconds. */
  duration: number;
  seed: number;
}

interface CameraTracks {
  zoom?: TrackKey[];
  x?: TrackKey[];
  y?: TrackKey[];
  rotate?: TrackKey[];
}

const DEFAULT_AMOUNT = 0.12;
const DEFAULT_EASE = 'ease-in-out-sine';
const TWO_PI = 6.283185;

function move(from: number, to: number, window: { start: number; end: number; ease: Camera['ease'] }): TrackKey[] {
  return [
    { t: window.start, v: from },
    { t: window.end, v: to, ease: window.ease ?? DEFAULT_EASE },
  ];
}

function presetTracks(camera: Camera, frame: CameraFrame): CameraTracks {
  const amount = camera.amount ?? DEFAULT_AMOUNT;
  const start = seconds(camera.delay) ?? 0;
  const window = { start, end: start + (camera.duration ?? Math.max(0.1, frame.duration - start)), ease: camera.ease };
  const reach = (0.8 * (frame.width * amount)) / 2;
  const hold = [{ t: 0, v: 1 + amount }];
  const table: Partial<Record<NonNullable<Camera['preset']>, CameraTracks>> = {
    'push-in': { zoom: move(1, 1 + amount, window) },
    'pull-out': { zoom: move(1 + amount, 1, window) },
    'drift-left': { zoom: hold, x: move(reach, -reach, window) },
    'drift-right': { zoom: hold, x: move(-reach, reach, window) },
    'drift-up': { zoom: hold, y: move(reach * 0.6, -reach * 0.6, window) },
    'drift-down': { zoom: hold, y: move(-reach * 0.6, reach * 0.6, window) },
    orbit: {
      zoom: move(1 + amount * 0.4, 1 + amount, window),
      x: move(-reach, reach, window),
      y: move(reach * 0.3, -reach * 0.3, window),
    },
  };

  return (camera.preset && table[camera.preset]) ?? {};
}

function numeric(keys: TrackKey[] | undefined): number[] {
  return (keys ?? []).map((key) => Number(key.v)).filter(Number.isFinite);
}

function hitsTerm(camera: Camera, time: string): string {
  return (camera.hits ?? [])
    .map((hit) => (typeof hit === 'object' ? hit : { at: hit }))
    .map(({ at, strength = 0.08, decay = 10 }) => {
      const land = fmt(seconds(at) ?? 0);

      return `+${fmt(strength)}*gte(${time},${land})*exp(-(${time}-${land})*${fmt(decay)})`;
    })
    .join('');
}

// Seeded wander: three incommensurate sines, so it never visibly loops.
function wander(amplitude: number, frequency: number, random: () => number, time: string): string {
  if (amplitude === 0) return '0';

  const parts = [
    [0.6, 1],
    [0.3, 2.31],
    [0.1, 5.13],
  ].map(
    ([weight, ratio]) => `${fmt(weight)}*sin(${TWO_PI}*${fmt(frequency * ratio)}*${time}+${fmt(random() * TWO_PI)})`
  );

  return `${fmt(amplitude)}*(${parts.join('+')})`;
}

/** Overscan factor that keeps the worst-case pan, shake and roll inside the source frame. */
function overscan(camera: Camera, tracks: CameraTracks, frame: CameraFrame): number {
  const shake = camera.shake ? (camera.shake.amplitude ?? 6) : 0;
  const panX = Math.max(0, ...numeric(tracks.x).map(Math.abs)) + shake;
  const panY = Math.max(0, ...numeric(tracks.y).map(Math.abs)) + shake;
  const roll = (Math.max(0, ...numeric(tracks.rotate).map(Math.abs)) + (camera.shake?.rotation ?? 0)) * (Math.PI / 180);
  const aspect = Math.max(frame.width, frame.height) / Math.min(frame.width, frame.height);
  const rollMargin = Math.cos(roll) + aspect * Math.sin(roll);
  const presetZoom = Math.min(...numeric(tracks.zoom), Infinity);
  const panMargin = 1 + 2 * Math.max(panX / frame.width, panY / frame.height);

  // A preset that already zooms in has room to pan; only add what it lacks.
  return rollMargin * Math.max(1, panMargin / (Number.isFinite(presetZoom) ? presetZoom : 1));
}

interface Rig {
  tracks: CameraTracks;
  shake: Camera['shake'];
}

function rig(camera: Camera, frame: CameraFrame): Rig | null {
  const preset = presetTracks(camera, frame);
  const tracks: CameraTracks = { ...preset, ...pick(camera) };
  const shake = camera.shake ?? (camera.preset === 'handheld' ? {} : undefined);
  const moves = Boolean(tracks.zoom ?? tracks.x ?? tracks.y ?? tracks.rotate);

  return moves || (camera.hits?.length ?? 0) > 0 || shake ? { tracks, shake } : null;
}

// One seeded wander term per call (x, then y), so the random stream order is fixed.
function sway(shake: Camera['shake'], random: () => number, time: string): string {
  return shake ? wander(shake.amplitude ?? 6, shake.frequency ?? 0.8, random, time) : '0';
}

function axis(keys: TrackKey[] | undefined, time: string, sway: string): string {
  return `(${keys ? trackExpr(keys, 0, time) : '0'})+${sway}`;
}

interface CameraLowering {
  move: ZoomMove;
  roll: string | null;
}

function lower(camera: Camera, frame: CameraFrame): CameraLowering | null {
  const plan = rig(camera, frame);

  if (!plan) return null;

  const { tracks, shake } = plan;
  const time = ZOOM_TIME;
  // One seeded stream, drawn in a fixed order: x wander, y wander, then roll.
  const random = seededRandom(frame.seed);
  const scaleFactor = fmt(overscan({ ...camera, shake }, tracks, frame));
  const zoom = `(${tracks.zoom ? trackExpr(tracks.zoom, 0, time) : '1'})*(1${hitsTerm(camera, time)})*${scaleFactor}`;
  const panX = axis(tracks.x, time, sway(shake, random, time));
  const panY = axis(tracks.y, time, sway(shake, random, time));
  const rolls = Boolean(tracks.rotate) || Boolean(shake?.rotation);
  const wobble = shake?.rotation ? wander(shake.rotation, (shake.frequency ?? 0.8) * 0.7, random, 't') : '0';

  return { move: { zoom, panX, panY }, roll: rolls ? axis(tracks.rotate, 't', wobble) : null };
}

/** The camera's zoom and pan as expressions in ZOOM_TIME (null when there is nothing to do). */
export function cameraMove(camera: Camera | undefined, frame: CameraFrame): ZoomMove | null {
  return camera ? (lower(camera, frame)?.move ?? null) : null;
}

/** The camera as raw filter strings for the end of a section chain ([] when there is nothing to do). */
export function cameraFilters(camera: Camera | undefined, frame: CameraFrame): string[] {
  const lowered = camera ? lower(camera, frame) : null;

  if (!lowered) return [];

  const filters = exactZoomFilters(lowered.move, frame);

  if (lowered.roll !== null) filters.push(`rotate=a='(${lowered.roll})*PI/180':fillcolor=black`);

  return filters;
}

function pick(camera: Camera): CameraTracks {
  const tracks: CameraTracks = {};

  if (camera.zoom) tracks.zoom = camera.zoom;

  if (camera.x) tracks.x = camera.x;

  if (camera.y) tracks.y = camera.y;

  if (camera.rotate) tracks.rotate = camera.rotate;

  return tracks;
}
