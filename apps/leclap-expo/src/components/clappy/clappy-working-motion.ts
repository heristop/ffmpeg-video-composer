// Clappy while a render runs: he trots in place, the web render loader's run (apps/leclap-web clappy.logic.ts:
// footStep, feet, RUN_CADENCE, runnerFrame) ported as pure functions of time, sampled on the UI thread, with no
// travel along a track. Seeded irregular blinks and glances ride the same two-minute clock, which wraps on a
// whole number of strides. A milestone cheer (clapper snapped shut, arms up, a grin) layers over the run.

export interface ClappyPose {
  /** Degrees added to the clapper's resting angle around the hinge. Negative opens, positive closes. */
  clapper: number;
  /** Degrees each arm swings outward from its resting angle. */
  armLeft: number;
  armRight: number;
  /** Degrees the body leans on its feet; positive leans forward into the run (to the right). */
  lean: number;
  /** Vertical offset in drawing units; negative is up. */
  bob: number;
  bodyScaleX: number;
  bodyScaleY: number;
  /** Foot offsets in drawing units. */
  leftFootX: number;
  leftFootY: number;
  rightFootX: number;
  rightFootY: number;
  /** Pupil offset in drawing units. */
  lookX: number;
  lookY: number;
  /** Eye openness: 1 open, near 0 shut. */
  blink: number;
  /** 0 smiling face, 1 joy face (happy arcs and a grin). */
  happy: number;
}

export interface FootOffset {
  dx: number;
  dy: number;
}

type Ease = 'linear' | 'inQuad' | 'outQuad' | 'outCubic' | 'inOutSine';
type Key = readonly [ms: number, value: number, ease?: Ease];

/** Run-cycle turns per second: the web runner's quick trot, a little over two strides a second. */
export const RUN_CADENCE = 2.25;
/** The clock's span: a whole number of strides (270), so the run wraps without a seam. */
export const LOOP_MS = 120_000;
export const CHEER_MS = 1150;
/** The clapper rests at the logo's open angle (-25°); this offset lays it flat on the board. */
export const CLAPPER_SHUT = 25;
export const RESTING_POSE: ClappyPose = {
  clapper: 0,
  armLeft: 0,
  armRight: 0,
  lean: 0,
  bob: 0,
  bodyScaleX: 1,
  bodyScaleY: 1,
  leftFootX: 0,
  leftFootY: 0,
  rightFootX: 0,
  rightFootY: 0,
  lookX: 0,
  lookY: 0,
  blink: 1,
  happy: 0,
};

const TAU = Math.PI * 2;
// The web runner's numbers: foot arc, arm rest and swing, clapper angle and clack, body lift and squash, lean.
const FOOT_LIFT = 16;
const FOOT_REACH = 16;
const ARM_REST = 50;
const RUN_ARM = 44;
const ARM_SWING = 30;
const REST_ANGLE = -25;
const RUN_ANGLE = -22;
const CLACK = 6;
/** The web lifts the body size/12 at the top of a bob: 50 units of the 600-unit drawing. */
const LIFT = 50;
const SQUASH = 0.03;
const LEAN = 8;
// Matches the web Clappy's pupil travel at a full look; he runs looking ahead (lookX 0.6), like the web runner.
const TRAVEL = { x: 10, y: 11 };
const AHEAD = { x: 0.6, y: 0 };
const BLINK_CLOSE = 70;
const BLINK_OPEN = 130;
const DOUBLE_GAP = 260;
const GLANCE_IN = 200;
const GLANCE_OUT = 300;

function seeded(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBlinks() {
  const random = seeded(7);
  const blinks: { at: number; double: boolean }[] = [];

  for (let at = 1800; at < LOOP_MS - 1000; at += 2600 + random() * 3800) {
    blinks.push({ at: Math.round(at), double: random() < 0.22 });
  }

  return blinks;
}

// Where a glance goes, in units of full travel: mostly down at the percentage and the bar under him.
const LOOKS = [
  { x: 0, y: 0.85 },
  { x: -0.3, y: 0.75 },
  { x: 0.35, y: 0.8 },
  { x: 0, y: 0.6 },
  { x: -0.6, y: -0.2 },
] as const;

function buildGlances() {
  const random = seeded(23);
  const glances: { at: number; hold: number; x: number; y: number }[] = [];

  for (let at = 3200; at < LOOP_MS - 4000;) {
    const hold = Math.round(900 + random() * 1100);
    const look = LOOKS[Math.floor(random() * LOOKS.length)];
    glances.push({ at: Math.round(at), hold, x: look.x, y: look.y });
    at += GLANCE_IN + hold + GLANCE_OUT + 3500 + random() * 5000;
  }

  return glances;
}

export const BLINKS: readonly { at: number; double: boolean }[] = buildBlinks();
export const GLANCES: readonly { at: number; hold: number; x: number; y: number }[] = buildGlances();

/** One foot's offset at a run-cycle phase: lifted in an arc through the first half-turn, planted through the second. */
export function footStep(phase: number): FootOffset {
  'worklet';
  const turn = phase * TAU;
  const rise = Math.sin(turn);

  // Planted is a plain 0 (never -0), so a settled pose compares equal to rest.
  return { dx: Math.cos(turn) * -FOOT_REACH, dy: rise > 0 ? -rise * FOOT_LIFT : 0 };
}

/** Both feet, half a turn apart: one pushes off while the other steps ahead. */
export function feet(stride: number): readonly [FootOffset, FootOffset] {
  'worklet';

  return [footStep(stride), footStep(stride + 0.5)];
}

function ease(kind: Ease | undefined, t: number) {
  'worklet';

  switch (kind) {
    case 'inQuad':
      return t * t;
    case 'outQuad':
      return 1 - (1 - t) * (1 - t);
    case 'outCubic':
      return 1 - (1 - t) ** 3;
    case 'inOutSine':
      return (1 - Math.cos(Math.PI * t)) / 2;
    default:
      return t;
  }
}

function sample(keys: readonly Key[], ms: number) {
  'worklet';
  // Worklets can't call Babel's helpers, so no array destructuring, for…of, spread or Array.prototype.at here.
  let last = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    last = key[1];

    if (i === 0 || ms > key[0]) continue;
    const previous = keys[i - 1];
    const span = key[0] - previous[0];

    return previous[1] + (key[1] - previous[1]) * ease(key[2], span === 0 ? 1 : (ms - previous[0]) / span);
  }

  return last;
}

function eyelid(ms: number) {
  'worklet';
  const d = ms;

  if (d < 0 || d > BLINK_CLOSE + BLINK_OPEN) return 1;

  if (d < BLINK_CLOSE) return 1 - 0.92 * ease('inQuad', d / BLINK_CLOSE);

  return 0.08 + 0.92 * ease('outCubic', (d - BLINK_CLOSE) / BLINK_OPEN);
}

function blinkAt(ms: number) {
  'worklet';
  return BLINKS.reduce(
    (open, blink) => Math.min(open, eyelid(ms - blink.at), blink.double ? eyelid(ms - blink.at - DOUBLE_GAP) : 1),
    1
  );
}

function lookAt(ms: number) {
  'worklet';

  const glance = GLANCES.find((entry) => {
    const since = ms - entry.at;

    return since >= 0 && since <= GLANCE_IN + entry.hold + GLANCE_OUT;
  });

  if (glance) {
    const d = ms - glance.at;
    const reach =
      d < GLANCE_IN
        ? ease('outCubic', d / GLANCE_IN)
        : 1 - ease('inOutSine', Math.max(0, d - GLANCE_IN - glance.hold) / GLANCE_OUT);

    return {
      lookX: (AHEAD.x * (1 - reach) + glance.x * reach) * TRAVEL.x,
      lookY: (AHEAD.y * (1 - reach) + glance.y * reach) * TRAVEL.y,
    };
  }

  return { lookX: AHEAD.x * TRAVEL.x, lookY: AHEAD.y * TRAVEL.y };
}

/** The stride on the run clock at `ms`. */
export function strideAt(ms: number) {
  'worklet';

  return ((ms - Math.floor(ms / LOOP_MS) * LOOP_MS) / 1000) * RUN_CADENCE;
}

/** The trot `ms` into the run; any time wraps into the loop. */
export function runPose(ms: number): ClappyPose {
  'worklet';
  const t = ms - Math.floor(ms / LOOP_MS) * LOOP_MS;
  const stride = strideAt(t);
  const swing = Math.sin(stride * TAU);
  const lift = Math.abs(Math.cos(stride * TAU));
  const steps = feet(stride);
  const look = lookAt(t);

  return {
    clapper: RUN_ANGLE + Math.sin(stride * 2 * TAU) * CLACK - REST_ANGLE,
    armLeft: RUN_ARM + swing * ARM_SWING - ARM_REST,
    armRight: RUN_ARM - swing * ARM_SWING - ARM_REST,
    lean: LEAN,
    bob: -lift * LIFT,
    bodyScaleX: 1 + lift * SQUASH,
    bodyScaleY: 1 - lift * SQUASH,
    leftFootX: steps[0].dx,
    leftFootY: steps[0].dy,
    rightFootX: steps[1].dx,
    rightFootY: steps[1].dy,
    lookX: look.lookX,
    lookY: look.lookY,
    blink: blinkAt(t),
    happy: 0,
  };
}

/** The web runner's dust: three puffs, each living one stride. Units are px for the 120 px runner it was sized for. */
export const DUST_PUFFS = 3;
export const DUST_RUNNER_PX = 120;
/** A puff's largest size (at the end of its stride); views draw it at this size and scale it down. */
export const PUFF_MAX = 26;

export interface Puff {
  /** Left edge, from the runner's left edge. */
  x: number;
  /** Bottom edge, up from the runner's bottom edge. */
  y: number;
  size: number;
  opacity: number;
}

/**
 * Puff `index` at `stride` (web: clappy-runner.tsx Dust), kicked up behind him and drifting back and up as it
 * grows and fades. A puff born after `stoppedAt` (the stride he began to stop on) is never shown, so the dust
 * dies down with him while the puffs already in the air finish fading.
 */
export function dustPuff(stride: number, index: number, stoppedAt = Number.POSITIVE_INFINITY): Puff {
  'worklet';
  const age = (stride + index / DUST_PUFFS) % 1;
  const born = stride - age;

  return {
    x: 18 - age * 46,
    y: 8 + age * 14,
    size: 10 + age * (PUFF_MAX - 10),
    opacity: born < stoppedAt ? (1 - age) * 0.6 : 0,
  };
}

// The cheer takes the clapper over from the run (wind up, snap shut, hold, spring back open), throws the arms up
// and swaps the face for a grin, then hands everything back to the run.
const CHEER_HOLD: readonly Key[] = [
  [0, 0],
  [200, 1, 'outQuad'],
  [900, 1],
  [CHEER_MS, 0, 'inOutSine'],
];
const CHEER_CLAPPER: readonly Key[] = [
  [0, 0],
  [300, -14, 'outCubic'],
  [390, CLAPPER_SHUT, 'inQuad'],
  [520, CLAPPER_SHUT],
  [1000, 0, 'outCubic'],
  [CHEER_MS, 0],
];
const CHEER_ARMS: readonly Key[] = [
  [0, 0],
  [300, 10, 'outCubic'],
  [420, 40, 'outQuad'],
  [800, 30],
  [CHEER_MS, 0, 'inOutSine'],
];
const CHEER_JOY: readonly Key[] = [
  [0, 0],
  [390, 0],
  [470, 1, 'outQuad'],
  [900, 1],
  [CHEER_MS, 0, 'inOutSine'],
];

/** The run with a milestone cheer at `phase` (0 to 1) over it; untouched at both ends. */
export function cheerPose(run: ClappyPose, phase: number): ClappyPose {
  'worklet';
  const ms = Math.min(1, Math.max(0, phase)) * CHEER_MS;
  const hold = sample(CHEER_HOLD, ms);
  const arms = sample(CHEER_ARMS, ms);
  const happy = sample(CHEER_JOY, ms);

  return Object.assign({}, run, {
    clapper: run.clapper * (1 - hold) + sample(CHEER_CLAPPER, ms) * hold,
    armLeft: run.armLeft + arms,
    armRight: run.armRight + arms,
    lookX: run.lookX * (1 - happy),
    lookY: run.lookY * (1 - happy),
    happy,
  });
}

/** Mixes `pose` with standing still: 0 is fully at rest, 1 is the pose unchanged. */
export function blendPose(pose: ClappyPose, amount: number): ClappyPose {
  'worklet';
  const mix = (rest: number, value: number) => rest * (1 - amount) + value * amount;

  return {
    clapper: mix(RESTING_POSE.clapper, pose.clapper),
    armLeft: mix(RESTING_POSE.armLeft, pose.armLeft),
    armRight: mix(RESTING_POSE.armRight, pose.armRight),
    lean: mix(RESTING_POSE.lean, pose.lean),
    bob: mix(RESTING_POSE.bob, pose.bob),
    bodyScaleX: mix(RESTING_POSE.bodyScaleX, pose.bodyScaleX),
    bodyScaleY: mix(RESTING_POSE.bodyScaleY, pose.bodyScaleY),
    leftFootX: mix(RESTING_POSE.leftFootX, pose.leftFootX),
    leftFootY: mix(RESTING_POSE.leftFootY, pose.leftFootY),
    rightFootX: mix(RESTING_POSE.rightFootX, pose.rightFootX),
    rightFootY: mix(RESTING_POSE.rightFootY, pose.rightFootY),
    lookX: mix(RESTING_POSE.lookX, pose.lookX),
    lookY: mix(RESTING_POSE.lookY, pose.lookY),
    blink: mix(RESTING_POSE.blink, pose.blink),
    happy: mix(RESTING_POSE.happy, pose.happy),
  };
}
