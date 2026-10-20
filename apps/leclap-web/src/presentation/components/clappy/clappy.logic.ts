import { clamp01 } from '@/presentation/components/kinetic/gradient-meter.logic';

// How Clappy acts, as pure maths so it is tested once: the run the render loader plays and the clap that
// greets a finished render. The choreography is the films' (the private leclap-brand-motion repo:
// src/film/acting.tsx and the showcase's loading run), timed in seconds instead of frames. Angles are in
// degrees; clappy.tsx draws whatever pose these return.

export type ClappyMood = 'smile' | 'grin' | 'wow' | 'wink' | 'focused' | 'proud' | 'love' | 'sleepy';

export interface ClappyPose {
  /** Top-stick angle in degrees; 0 = shut, REST_ANGLE = the logo's resting open angle. */
  angle?: number;
  /** Where the pupils look, each -1..1. */
  lookX?: number;
  lookY?: number;
  /** 0 = open eyes, 1 = shut. */
  blink?: number;
  mood?: ClappyMood;
  /** Arm angles in degrees from hanging straight down, swinging outward (90 = level, 150 = raised). */
  armL?: number;
  armR?: number;
  /**
   * Run-cycle phase in turns (repeats every 1): the feet trade places, one lifting and stepping ahead while
   * the other pushes off. Unset, Clappy stands.
   */
  stride?: number;
}

/** The logo's clapper, open at rest. */
export const REST_ANGLE = -25;

const TAU = Math.PI * 2;

const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;

/** How far `value` has come from `from` to `to`, 0..1. */
const between = (value: number, from: number, to: number): number => clamp01((value - from) / (to - from));

const easeOut = (amount: number): number => 1 - (1 - amount) ** 3;

const easeIn = (amount: number): number => amount ** 3;

export interface FootOffset {
  dx: number;
  dy: number;
}

// How high a stepping foot lifts. The feet are drawn behind the board, which hides all but their lowest 30 units,
// so a higher lift would tuck the foot out of sight and leave him sliding on his belly: at this height a raised
// foot still shows under the board, clearly above the planted one.
const FOOT_LIFT = 16;

/** One foot's offset at a run-cycle phase: lifted in an arc through the first half-turn, planted through the second. */
export const footStep = (phase: number | undefined): FootOffset => {
  if (phase === undefined) return { dx: 0, dy: 0 };

  const turn = phase * TAU;

  return { dx: Math.cos(turn) * -16, dy: -Math.max(0, Math.sin(turn)) * FOOT_LIFT };
};

/** Both feet, half a turn apart: one pushes off while the other steps ahead. */
export const feet = (stride: number | undefined): readonly [FootOffset, FootOffset] => [
  footStep(stride),
  footStep(stride === undefined ? undefined : stride + 0.5),
];

// ── The run ─────────────────────────────────────────────────────────────────────────────────────────

/** Run-cycle turns per second: a quick trot, a little over two strides a second (the film's 0.075 a frame at 30 fps). */
export const RUN_CADENCE = 2.25;

export interface RunnerFrame {
  pose: ClappyPose;
  /** How high the stride has lifted the body: 0 on the ground, 1 at the top. */
  bob: number;
  /** Forward lean, in degrees. */
  lean: number;
}

/** At the finish line: arms thrown up, grinning. */
const ARRIVED: RunnerFrame = { pose: { armL: 140, armR: 140, mood: 'grin', lookX: 0.6 }, bob: 0, lean: 0 };

/** Ready on the line, eyes on the track: the runner when motion has to keep still. */
const WAITING: RunnerFrame = { pose: { mood: 'smile', lookX: 0.6 }, bob: 0, lean: 0 };

/**
 * The render loader's runner, `seconds` into the run: feet trading places, arms pumping, the clapper clacking
 * on each step, a bob and a lean into the run. It stands on the line when motion has to keep still, and
 * cheers at the finish. His eyes stay wide open and he smiles as he runs: narrowed, at the sizes he runs at,
 * they read as a squint, and the grin is saved for the finish.
 */
export const runnerFrame = (seconds: number, { done, still }: { done: boolean; still: boolean }): RunnerFrame => {
  if (done) return ARRIVED;

  if (still) return WAITING;

  const stride = seconds * RUN_CADENCE;
  const swing = Math.sin(stride * TAU);

  return {
    pose: {
      stride,
      armL: 44 + swing * 30,
      armR: 44 - swing * 30,
      angle: -22 + Math.sin(stride * 2 * TAU) * 6,
      mood: 'smile',
      lookX: 0.6,
    },
    bob: Math.abs(Math.cos(stride * TAU)),
    lean: 8,
  };
};

// ── The spring ──────────────────────────────────────────────────────────────────────────────────────

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

/**
 * How far a spring let go from rest has travelled toward its target after `seconds`: 0 at the start, 1 on
 * the target, past 1 while an under-damped spring overshoots. Closed form, so a pose stays a pure function of
 * time; a spring damped critically or more settles along the critical curve.
 */
export const springProgress = (seconds: number, { stiffness, damping, mass }: SpringConfig): number => {
  if (seconds <= 0) return 0;

  const omega = Math.sqrt(stiffness / mass);
  const ratio = damping / (2 * Math.sqrt(stiffness * mass));

  if (ratio >= 1) return 1 - Math.exp(-omega * seconds) * (1 + omega * seconds);

  const decay = Math.exp(-ratio * omega * seconds);
  const ringing = omega * Math.sqrt(1 - ratio * ratio);

  return 1 - decay * (Math.cos(ringing * seconds) + ((ratio * omega) / ringing) * Math.sin(ringing * seconds));
};

// ── The finishing clap ──────────────────────────────────────────────────────────────────────────────

/** When the stick hits the board, in seconds into the cheer: the clack sounds on this frame. */
export const SLAM_AT = 0.6;

/** When the cheer has settled for good, so its clock can stop. */
export const CHEER_SECONDS = 2.8;

// The clap as the films time it at 30 fps: a ten-frame wind-up to 14° wider, a four-frame slam, three frames
// held shut, then a wobbly spring back open.
const WIND_UP = 0.47;
const SHUT = 0.13;
const HOLD = 0.1;
const WIDER = 14;
const REOPEN: SpringConfig = { stiffness: 210, damping: 7, mass: 0.6 };

// The arms: thrown up on the slam, lowered once the cheer has landed.
const ARMS_REST = 50;
const ARMS_UP = 140;
const LOWER_AFTER = 1.2;
const THROW: SpringConfig = { stiffness: 180, damping: 11, mass: 0.8 };
const LOWER: SpringConfig = { stiffness: 120, damping: 14, mass: 1 };

// The impact: a squash peaking two frames after the slam, gone twelve frames later.
const IMPACT_PEAK = 0.067;
const IMPACT_FADE = 0.4;

interface ClapCourse {
  /** How long before the slam the wind-up starts, in seconds. */
  windUp?: number;
  /** Where the stick stands as it starts winding up. */
  from?: number;
  /** Where it springs back open to after the slam. */
  rest?: number;
  /** The spring it reopens on. */
  reopen?: SpringConfig;
}

/**
 * The top stick, `fromSlam` seconds from the slam (negative before it): wound wider from `from`, slammed shut,
 * held, then sprung back open to `rest`. The cheer's clap starts and ends at the logo's resting angle.
 */
const clapAngle = (
  fromSlam: number,
  { windUp = WIND_UP, from = REST_ANGLE, rest = REST_ANGLE, reopen = REOPEN }: ClapCourse = {}
): number => {
  if (fromSlam < -SHUT) return mix(from, REST_ANGLE - WIDER, easeOut(between(fromSlam, -windUp, -SHUT)));

  if (fromSlam < HOLD) return mix(REST_ANGLE - WIDER, 0, easeIn(between(fromSlam, -SHUT, 0)));

  return mix(0, rest, springProgress(fromSlam - HOLD, reopen));
};

// The arms go up at the slam and stay up: the finished render ends on Clappy celebrating, smiling.
const armsAt = (fromSlam: number): number => mix(ARMS_REST, ARMS_UP, springProgress(fromSlam, THROW));

// The wind-up keeps his smile: a focused brow there reads as a frown just before the render lands.
const moodAt = (fromSlam: number): ClappyMood => {
  if (fromSlam >= 0 && fromSlam < LOWER_AFTER + 0.2) return 'grin';

  return 'smile';
};

const impactAt = (fromSlam: number): number => {
  if (fromSlam < 0) return 0;

  if (fromSlam < IMPACT_PEAK) return fromSlam / IMPACT_PEAK;

  return 1 - between(fromSlam, IMPACT_PEAK, IMPACT_PEAK + IMPACT_FADE);
};

export interface CheerFrame {
  pose: ClappyPose;
  /** The slam's impact, 0..1: how hard the body squashes onto its feet. */
  impact: number;
}

/**
 * The cheer that greets a finished render, `seconds` in: Clappy winds the clapper up, slams it shut at
 * SLAM_AT, throws both arms up grinning while the stick wobbles back open, then keeps them up and settles into a
 * smile, held from CHEER_SECONDS on.
 */
export const cheerFrame = (seconds: number): CheerFrame => {
  const fromSlam = Math.min(seconds, CHEER_SECONDS) - SLAM_AT;
  const arms = armsAt(fromSlam);

  return {
    pose: { angle: clapAngle(fromSlam), armL: arms, armR: arms, mood: moodAt(fromSlam) },
    impact: impactAt(fromSlam),
  };
};

/** Whether a clock stepping from `previous` to `current` reached `moment` on this step. */
export const crossed = (previous: number, current: number, moment: number): boolean =>
  previous < moment && current >= moment;

// ── The clap on a click ─────────────────────────────────────────────────────────────────────────────

// The cheer's clap with the wind-up cut short, so the clack answers the click at once, and the whole body in it.
// It is laid over whatever pose he's in: it takes the stick and the arms from where they stand, adds the impact,
// grins for a beat once it lands, and hands them back to the pose once they have sprung back into it.
const CLICK_WIND_UP = 0.14;
const CLICK_GRIN = 0.5;
// A touch firmer than the cheer's reopening, still wobbly, so the whole clap is over inside a second.
const CLICK_REOPEN: SpringConfig = { stiffness: 210, damping: 9.5, mass: 0.6 };

// The arms: up and back as the stick winds up, thrown up and out on the slam in a little ta-da, then sprung back
// down into the pose, overshooting a touch, since this is a moment with momentum in it. The ta-da holds them well
// above level: both arms level read as pot handles.
const WIND_ARMS = 165;
const TADA_ARMS = 132;
const TADA_FOR = 0.2;
const DROP: SpringConfig = { stiffness: 300, damping: 23, mass: 1 };

/** When a clicked Clappy's stick hits the board, in seconds after the click: the clack sounds on this frame. */
export const CLICK_SLAM_AT = CLICK_WIND_UP + SHUT;

/**
 * When the click's clap has sprung back into the pose, so its clock can stop: from a step before it on, the stick
 * and the arms are within half a degree of the pose's, so handing them back never jumps.
 */
export const CLICK_CLAP_SECONDS = CLICK_SLAM_AT + HOLD + 0.62;

/** The parts of a pose a click's clap takes over: the stick and both arms. */
export interface ClapParts {
  angle: number;
  armL: number;
  armR: number;
}

/** A pose's stick and arms, as clappy.tsx draws them when the pose leaves them out. */
export const clapParts = ({ angle = REST_ANGLE, armL = ARMS_REST, armR = ARMS_REST }: ClappyPose): ClapParts => ({
  angle,
  armL,
  armR,
});

export interface ClickClapFrame extends ClapParts {
  /** The slam's impact, 0..1, as in the cheer. */
  impact: number;
  /** He grins, whatever the pose's mood. */
  grin: boolean;
}

/** One arm, `seconds` into a click's clap, from `from` when clicked back to `rest`, the pose's own. */
const clickArm = (seconds: number, from: number, rest: number): number => {
  const fromSlam = seconds - CLICK_SLAM_AT;

  if (fromSlam < 0) return mix(from, WIND_ARMS, easeOut(between(seconds, 0, CLICK_SLAM_AT)));

  // The throw and the drop as two steps of one sprung arm, added up, so it carries its swing from one to the next.
  return (
    WIND_ARMS +
    (TADA_ARMS - WIND_ARMS) * springProgress(fromSlam, THROW) +
    (rest - TADA_ARMS) * springProgress(fromSlam - TADA_FOR, DROP)
  );
};

/**
 * The clap a click plays, `seconds` after it: from `from`, where stick and arms stood when clicked, the stick winds
 * wider as the arms swing up and back, slams shut as they throw up and out, and both spring back to `rest`, the
 * pose's own, while the body squashes on the impact.
 */
export const clickClapFrame = (seconds: number, from: ClapParts, rest: ClapParts): ClickClapFrame => {
  const fromSlam = seconds - CLICK_SLAM_AT;

  return {
    angle: clapAngle(fromSlam, { windUp: CLICK_SLAM_AT, from: from.angle, rest: rest.angle, reopen: CLICK_REOPEN }),
    armL: clickArm(seconds, from.armL, rest.armL),
    armR: clickArm(seconds, from.armR, rest.armR),
    impact: impactAt(fromSlam),
    grin: fromSlam >= 0 && fromSlam < CLICK_GRIN,
  };
};

/**
 * Whether a click starts a clap, `seconds` into the one playing (null: none is). Not while a slam is on its way:
 * starting over would keep putting the clack off, and rapid clicks have to read as rapid claps.
 */
export const clickClapRestarts = (seconds: number | null): boolean => seconds === null || seconds >= CLICK_SLAM_AT;

// ── Reactions ───────────────────────────────────────────────────────────────────────────────────────

/** How Clappy takes a page that went wrong: each error page has its own one-shot reaction. */
export type ClappyReaction = 'search' | 'puzzle' | 'cut' | 'wink' | 'doze' | 'wave';

export interface ReactionFrame {
  pose: ClappyPose;
  /** The slam's impact, 0..1, as in the cheer. */
  impact: number;
  /** Head tilt, in degrees (negative leans left). */
  tilt: number;
}

/** When the crash reaction's slam lands, in seconds. */
export const CUT_SLAM_AT = 0.5;

/** How long each reaction plays before it holds its last pose; 0 = a still pose. */
export const REACTION_SECONDS: Record<ClappyReaction, number> = {
  search: 2.8,
  puzzle: 1.2,
  cut: CUT_SLAM_AT + 0.9,
  wink: 0,
  doze: 0,
  wave: 2.55,
};

/** A value that eases between timed keys, [seconds, value], holding the first before and the last after. */
const track = (seconds: number, keys: readonly (readonly [number, number])[]): number => {
  const next = keys.findIndex(([at]) => at > seconds);

  if (next === -1) return keys.at(-1)?.[1] ?? 0;

  if (next === 0) return keys[0][1];

  const [fromAt, from] = keys[next - 1];
  const [toAt, to] = keys[next];
  const amount = between(seconds, fromAt, toAt);

  return mix(from, to, amount * amount * (3 - 2 * amount));
};

// The search: eyes left, then right, then back on the visitor with a shrug.
const SEARCH_LOOK = [
  [0.2, 0],
  [0.5, -1],
  [0.95, -1],
  [1.3, 1],
  [1.75, 1],
  [2, 0],
] as const;
const SHRUG_AT = 1.9;

const search = (seconds: number): ReactionFrame => {
  // Hands up past level: both arms held level read as pot handles, not a shrug.
  const arms = mix(ARMS_REST, 116, springProgress(seconds - SHRUG_AT, THROW));

  return {
    pose: {
      lookX: track(seconds, SEARCH_LOOK),
      armL: arms,
      armR: arms,
      mood: seconds < SHRUG_AT ? 'focused' : 'smile',
    },
    impact: 0,
    tilt: 0,
  };
};

// The puzzle: a hand up scratching the hinge, eyes up and to the side, the head tilted; the scratching
// fades out and the hand stays.
const SCRATCH_ARM = 154;

const puzzle = (seconds: number): ReactionFrame => {
  const scratch = Math.sin(seconds * TAU * 3) * 7 * (1 - between(seconds, 0.8, REACTION_SECONDS.puzzle));

  return {
    pose: { armL: SCRATCH_ARM + scratch, armR: 46, mood: 'focused', lookX: -0.35, lookY: -0.6 },
    impact: 0,
    tilt: -5,
  };
};

// The cut: the clapper winds up and slams shut, as a director calls it, and stays shut; eyes wide, arms up
// a little in surprise.
const cut = (seconds: number): ReactionFrame => {
  const fromSlam = seconds - CUT_SLAM_AT;
  const arms = mix(ARMS_REST, 72, springProgress(fromSlam, THROW));

  return {
    pose: {
      angle: fromSlam < 0 ? clapAngle(fromSlam) : 0,
      armL: arms,
      armR: arms,
      mood: fromSlam < 0 ? 'focused' : 'wow',
    },
    impact: impactAt(fromSlam),
    tilt: 0,
  };
};

// The wave, for a welcome: a hand thrown up and waved three times from the shoulder, then left up in a
// hello while the other arm stays down.
const WAVE_UP = 0.3;
const WAVE_FOR = 1.35;
const WAVE_ARM = 144;
const HELLO_ARM = 118;

const wave = (seconds: number): ReactionFrame => {
  const waveEnd = WAVE_UP + WAVE_FOR;
  const raised = mix(ARMS_REST, WAVE_ARM, springProgress(seconds, THROW));
  const lowered = mix(raised, HELLO_ARM, springProgress(seconds - waveEnd, LOWER));
  // The swing eases out over its last beat, so the hand settles instead of snapping still.
  const swing =
    seconds < WAVE_UP
      ? 0
      : Math.sin((seconds - WAVE_UP) * TAU * 2.2) * 14 * (1 - between(seconds, waveEnd - 0.3, waveEnd));

  return {
    pose: { armL: 44, armR: lowered + swing, mood: seconds < waveEnd ? 'grin' : 'smile', lookX: 0.1 },
    impact: 0,
    tilt: 3,
  };
};

const STILL: Record<'wink' | 'doze', ReactionFrame> = {
  // A new version: a wink and a hand up, hello.
  wink: { pose: { mood: 'wink', armL: ARMS_REST, armR: 118, lookX: 0.2 }, impact: 0, tilt: 0 },
  // No connection: dozing, the clapper drooping half shut.
  doze: { pose: { mood: 'sleepy', angle: -9, armL: 36, armR: 36, lookY: 0.4 }, impact: 0, tilt: 3 },
};

const REACTIONS: Record<ClappyReaction, (seconds: number) => ReactionFrame> = {
  search,
  puzzle,
  cut,
  wink: () => STILL.wink,
  doze: () => STILL.doze,
  wave,
};

/** A reaction `seconds` in; past REACTION_SECONDS it holds the last pose. */
export const reactionFrame = (reaction: ClappyReaction, seconds: number): ReactionFrame =>
  REACTIONS[reaction](Math.min(seconds, REACTION_SECONDS[reaction]));

// ── The camera countdown ────────────────────────────────────────────────────────────────────────────

/** When the stick hits the board after "Action!", in seconds from the end of the count. */
export const COUNTDOWN_SLAM_AT = 0.12;

/**
 * Clappy on the camera's 3·2·1, `seconds` into the current beat: the clapper held wide open, eyes on the
 * lens and a hand up like a cue, each new number landing with a small bounce. On "Action!" (`value` null)
 * the stick slams shut, the cue hand drops, and he grins.
 */
export const countdownFrame = (value: number | null, seconds: number): ReactionFrame => {
  if (value === null) {
    const fromSlam = seconds - COUNTDOWN_SLAM_AT;

    return {
      pose: {
        angle: mix(REST_ANGLE - WIDER, 0, easeIn(between(seconds, 0, COUNTDOWN_SLAM_AT))),
        armL: mix(150, 64, springProgress(fromSlam, THROW)),
        armR: ARMS_REST,
        mood: fromSlam < 0 ? 'focused' : 'grin',
        lookX: 0,
      },
      impact: impactAt(fromSlam),
      tilt: 0,
    };
  }

  return {
    pose: { angle: REST_ANGLE - WIDER, armL: 150, armR: ARMS_REST, mood: 'focused', lookX: 0 },
    impact: (1 - between(seconds, 0, 0.35)) * 0.45,
    tilt: 0,
  };
};
