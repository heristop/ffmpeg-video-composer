import { describe, expect, it } from 'vitest';
import {
  CHEER_SECONDS,
  CLICK_CLAP_SECONDS,
  CLICK_SLAM_AT,
  COUNTDOWN_SLAM_AT,
  CUT_SLAM_AT,
  REACTION_SECONDS,
  REST_ANGLE,
  RUN_CADENCE,
  SLAM_AT,
  cheerFrame,
  clickClapFrame,
  clickClapRestarts,
  countdownFrame,
  crossed,
  feet,
  footStep,
  reactionFrame,
  runnerFrame,
  springProgress,
  type ClappyReaction,
} from './clappy.logic';

const running = { done: false, still: false };

describe('footStep', () => {
  it('stands still without a stride', () => {
    expect(footStep(undefined)).toEqual({ dx: 0, dy: 0 });
  });

  it('lifts the foot at the top of its arc and keeps it planted through the second half-turn', () => {
    expect(footStep(0.25).dy).toBeLessThan(-12);
    expect(footStep(0.75).dy).toBeCloseTo(0);
  });

  it('never lifts a foot out of sight behind the board: a raised foot still shows under it', () => {
    const lifts = Array.from({ length: 40 }, (_, index) => footStep(index / 40).dy);

    expect(Math.min(...lifts)).toBeGreaterThanOrEqual(-20);
  });

  it('pushes off from behind and lands ahead', () => {
    expect(footStep(0).dx).toBeCloseTo(-16);
    expect(footStep(0.5).dx).toBeCloseTo(16);
  });
});

describe('feet', () => {
  it('keeps one foot on the ground while the other is in the air', () => {
    for (const stride of [0.1, 0.3, 0.6, 0.9, 1.2]) {
      const [left, right] = feet(stride);

      expect(Math.min(left.dy, right.dy)).toBeLessThan(0);
      expect(Math.max(left.dy, right.dy)).toBeCloseTo(0);
    }
  });
});

describe('runnerFrame', () => {
  it('runs a little over two strides a second', () => {
    expect(runnerFrame(1, running).pose.stride).toBeCloseTo(RUN_CADENCE);
  });

  it('pumps the arms in opposition', () => {
    for (const seconds of [0, 0.1, 0.23, 0.4]) {
      const { armL = 0, armR = 0 } = runnerFrame(seconds, running).pose;

      expect(armL + armR).toBeCloseTo(88);
    }
  });

  it('clacks the clapper around its running angle', () => {
    const angles = Array.from({ length: 40 }, (_, index) => runnerFrame(index / 40, running).pose.angle ?? 0);

    expect(Math.min(...angles)).toBeGreaterThanOrEqual(-28);
    expect(Math.max(...angles)).toBeLessThanOrEqual(-16);
  });

  it('bobs between the ground and the top of each stride, leaning into the run', () => {
    for (const seconds of [0, 0.05, 0.11, 0.3]) {
      const frame = runnerFrame(seconds, running);

      expect(frame.bob).toBeGreaterThanOrEqual(0);
      expect(frame.bob).toBeLessThanOrEqual(1);
      expect(frame.lean).toBeGreaterThan(0);
    }
  });

  it('runs with his eyes wide open and a smile, looking ahead down the track', () => {
    for (const seconds of [0, 0.2, 0.7]) {
      const { pose } = runnerFrame(seconds, running);

      expect(pose.mood).toBe('smile');
      expect(pose.lookX).toBeGreaterThan(0.4);
    }
  });

  it('stands on the spot, upright, when the motion has to keep still', () => {
    const frame = runnerFrame(0.3, { done: false, still: true });

    expect(frame.pose.stride).toBeUndefined();
    expect(frame.bob).toBe(0);
    expect(frame.lean).toBe(0);
  });

  it('waits on the line with his eyes open too, looking ahead', () => {
    const { pose } = runnerFrame(0.3, { done: false, still: true });

    expect(pose.mood).toBe('smile');
    expect(pose.lookX).toBeGreaterThan(0.4);
  });

  it('throws its arms up and grins at the finish, still motion or not', () => {
    for (const still of [false, true]) {
      const { pose, lean } = runnerFrame(0.3, { done: true, still });

      expect(pose.stride).toBeUndefined();
      expect(pose.mood).toBe('grin');
      expect(pose.armL).toBeGreaterThan(120);
      expect(lean).toBe(0);
    }
  });
});

describe('springProgress', () => {
  const wobbly = { stiffness: 210, damping: 7, mass: 0.6 };

  it('starts at rest', () => {
    expect(springProgress(0, wobbly)).toBe(0);
    expect(springProgress(-1, wobbly)).toBe(0);
  });

  it('overshoots its target, then settles on it', () => {
    const samples = Array.from({ length: 60 }, (_, index) => springProgress(index / 60, wobbly));

    expect(Math.max(...samples)).toBeGreaterThan(1.2);
    expect(springProgress(2, wobbly)).toBeCloseTo(1, 3);
  });

  it('never overshoots when critically damped', () => {
    const critical = { stiffness: 100, damping: 20, mass: 1 };
    const samples = Array.from({ length: 90 }, (_, index) => springProgress(index / 30, critical));

    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    expect(springProgress(3, critical)).toBeCloseTo(1, 3);
  });
});

describe('cheerFrame', () => {
  it('starts from the logo’s resting clapper', () => {
    expect(cheerFrame(0).pose.angle).toBeCloseTo(REST_ANGLE);
  });

  it('smiles through the wind-up instead of frowning before the slam', () => {
    expect(cheerFrame(0).pose.mood).toBe('smile');
    expect(cheerFrame(SLAM_AT - 0.05).pose.mood).toBe('smile');
  });

  it('winds the clapper up wider before the slam', () => {
    expect(cheerFrame(SLAM_AT - 0.2).pose.angle).toBeLessThan(REST_ANGLE - 5);
  });

  it('is shut on the slam, as the impact lands and the grin arrives', () => {
    const slam = cheerFrame(SLAM_AT);

    expect(slam.pose.angle).toBe(0);
    expect(slam.pose.mood).toBe('grin');
    expect(cheerFrame(SLAM_AT + 0.05).impact).toBeGreaterThan(0.5);
  });

  it('throws both arms up after the clap', () => {
    const { armL = 0, armR = 0 } = cheerFrame(SLAM_AT + 0.4).pose;

    expect(armL).toBeGreaterThan(120);
    expect(armR).toBe(armL);
  });

  it('settles into a smile, the clapper open again and the arms down', () => {
    const settled = cheerFrame(CHEER_SECONDS);

    expect(settled.pose.angle).toBeCloseTo(REST_ANGLE, 0);
    expect(settled.pose.armL).toBeLessThan(70);
    expect(settled.pose.mood).toBe('smile');
    expect(settled.impact).toBe(0);
  });

  it('holds the settled pose once the cheer is over', () => {
    expect(cheerFrame(CHEER_SECONDS + 10)).toEqual(cheerFrame(CHEER_SECONDS));
  });
});

describe('crossed', () => {
  it('is true only for the step that reaches the moment', () => {
    expect(crossed(0.5, 0.6, 0.55)).toBe(true);
    expect(crossed(0.4, 0.55, 0.55)).toBe(true);
    expect(crossed(0.55, 0.6, 0.55)).toBe(false);
    expect(crossed(0.1, 0.2, 0.55)).toBe(false);
  });

  it('catches a jump straight past the moment', () => {
    expect(crossed(-1, CHEER_SECONDS, SLAM_AT)).toBe(true);
  });
});

describe('reactionFrame', () => {
  it('looks left, then right, then shrugs at the visitor when a page is missing', () => {
    expect(reactionFrame('search', 0.6).pose.lookX).toBeLessThan(-0.5);
    expect(reactionFrame('search', 1.5).pose.lookX).toBeGreaterThan(0.5);

    const shrug = reactionFrame('search', REACTION_SECONDS.search).pose;

    expect(shrug.lookX).toBeCloseTo(0);
    expect(shrug.armL).toBeGreaterThan(85);
    // Both arms level reads as pot handles, not a shrug: the hands go up past level.
    expect(Math.abs((shrug.armL ?? 0) - 90)).toBeGreaterThan(15);
    expect(shrug.armR).toBe(shrug.armL);
  });

  it('scratches its head over a request it cannot read, then keeps the hand there', () => {
    const scratch = Array.from({ length: 20 }, (_, index) => reactionFrame('puzzle', index / 20).pose.armL ?? 0);

    expect(Math.min(...scratch)).toBeGreaterThan(140);
    expect(Math.max(...scratch) - Math.min(...scratch)).toBeGreaterThan(4);
    expect(reactionFrame('puzzle', REACTION_SECONDS.puzzle).pose.armL).toBeCloseTo(154);
    expect(reactionFrame('puzzle', 0).tilt).toBeLessThan(0);
  });

  it('slams the clapper shut on a crash and leaves it shut', () => {
    expect(reactionFrame('cut', CUT_SLAM_AT - 0.2).pose.angle).toBeLessThan(REST_ANGLE);
    expect(reactionFrame('cut', CUT_SLAM_AT).pose.angle).toBe(0);
    expect(reactionFrame('cut', CUT_SLAM_AT + 0.05).impact).toBeGreaterThan(0.5);

    const after = reactionFrame('cut', REACTION_SECONDS.cut);

    expect(after.pose.angle).toBe(0);
    expect(after.pose.mood).toBe('wow');
    expect(after.impact).toBe(0);
  });

  it('winks and dozes without moving', () => {
    expect(REACTION_SECONDS.wink).toBe(0);
    expect(reactionFrame('wink', 0).pose.mood).toBe('wink');
    expect(REACTION_SECONDS.doze).toBe(0);
    expect(reactionFrame('doze', 0).pose.mood).toBe('sleepy');
  });

  it('holds its last pose once the reaction is over', () => {
    const reactions: ClappyReaction[] = ['search', 'puzzle', 'cut', 'wink', 'doze', 'wave'];

    for (const reaction of reactions) {
      const end = REACTION_SECONDS[reaction];

      expect(reactionFrame(reaction, end + 5)).toEqual(reactionFrame(reaction, end));
    }
  });
});

describe('wave', () => {
  it('raises a hand and waves it, grinning', () => {
    const arms = Array.from({ length: 24 }, (_, index) => reactionFrame('wave', 0.4 + index / 24).pose.armR ?? 0);

    expect(Math.min(...arms)).toBeGreaterThan(125);
    expect(Math.max(...arms) - Math.min(...arms)).toBeGreaterThan(15);
    expect(reactionFrame('wave', 0.8).pose.mood).toBe('grin');
  });

  it('keeps the other arm down and ends with the hand up, smiling', () => {
    const end = reactionFrame('wave', REACTION_SECONDS.wave).pose;

    expect(end.armL).toBeLessThan(60);
    expect(end.armR).toBeCloseTo(118, 0);
    expect(end.mood).toBe('smile');
  });
});

describe('countdownFrame', () => {
  it('holds the clapper wide open while the numbers count down, eyes on the lens', () => {
    const { pose } = countdownFrame(2, 0.5);

    expect(pose.angle).toBeLessThan(REST_ANGLE - 5);
    expect(pose.lookX).toBe(0);
    expect(pose.mood).toBe('focused');
  });

  it('bounces on each new number, then settles', () => {
    expect(countdownFrame(3, 0.05).impact).toBeGreaterThan(0.2);
    expect(countdownFrame(3, 0.6).impact).toBe(0);
  });

  it('slams shut on "Action!", grinning, with the impact landing', () => {
    const slam = countdownFrame(null, COUNTDOWN_SLAM_AT);

    expect(slam.pose.angle).toBe(0);
    expect(slam.pose.mood).toBe('grin');
    expect(countdownFrame(null, COUNTDOWN_SLAM_AT + 0.05).impact).toBeGreaterThan(0.5);
    expect(countdownFrame(null, 0).pose.angle).toBeLessThan(REST_ANGLE);
  });
});

describe('clickClapFrame', () => {
  const standing = { angle: REST_ANGLE, armL: 50, armR: 50 };
  const dozing = { angle: -9, armL: 36, armR: 36 };
  const waving = { angle: -22, armL: 44, armR: 118 };

  /** The frames of a clap at 60 fps, from the click to the end. */
  const clapFrames = (from = standing, rest = standing) =>
    Array.from({ length: Math.round(CLICK_CLAP_SECONDS * 60) }, (_, index) => clickClapFrame(index / 60, from, rest));

  it('takes the stick and the arms from wherever they stood when clicked, without a jump', () => {
    expect(clickClapFrame(0, dozing, dozing)).toMatchObject(dozing);

    const midClap = { angle: -30, armL: 120, armR: 70 };

    expect(clickClapFrame(0, midClap, standing)).toMatchObject(midClap);
  });

  it('winds the stick wider while the arms swing up and back', () => {
    const winding = clickClapFrame(CLICK_SLAM_AT - 0.14, standing, standing);

    expect(winding.angle).toBeLessThan(REST_ANGLE - 10);
    expect(winding.armL).toBeGreaterThan(140);
    expect(winding.armR).toBe(winding.armL);
  });

  it('answers the click quickly: shut on the slam, as the impact lands', () => {
    expect(CLICK_SLAM_AT).toBeLessThan(0.35);
    expect(clickClapFrame(CLICK_SLAM_AT, standing, standing).angle).toBe(0);
    expect(clickClapFrame(CLICK_SLAM_AT + 0.05, standing, standing).impact).toBeGreaterThan(0.5);
    expect(clickClapFrame(CLICK_SLAM_AT - 0.05, standing, standing).impact).toBe(0);
  });

  it('throws the arms up and out on the slam, a little ta-da', () => {
    const tada = Array.from({ length: 10 }, (_, index) =>
      clickClapFrame(CLICK_SLAM_AT + 0.04 + index / 60, standing, standing)
    );

    for (const { armL, armR } of tada) {
      expect(armL).toBeGreaterThan(115);
      expect(armL).toBeLessThan(170);
      expect(armR).toBe(armL);
    }
  });

  it('only ever passes through both arms level, which reads as pot handles', () => {
    const level = clapFrames().filter(({ armL, armR }) => Math.abs(armL - 90) < 10 && Math.abs(armR - 90) < 10);

    expect(level.length).toBeLessThanOrEqual(4);
  });

  it('springs the arms back down into the pose, overshooting a little on the way', () => {
    const drop = clapFrames().filter((_, index) => index / 60 > CLICK_SLAM_AT + 0.2);
    const lowest = Math.min(...drop.map(({ armL }) => armL));

    expect(lowest).toBeLessThan(50);
    expect(lowest).toBeGreaterThan(40);
  });

  it('grins for a beat once it lands, and not before', () => {
    expect(clickClapFrame(CLICK_SLAM_AT - 0.05, standing, standing).grin).toBe(false);
    expect(clickClapFrame(CLICK_SLAM_AT + 0.2, standing, standing).grin).toBe(true);
    expect(clickClapFrame(CLICK_CLAP_SECONDS, standing, standing).grin).toBe(false);
  });

  it('wobbles the stick back open, and hands stick and arms back to the pose without a jump', () => {
    const wobble = clapFrames(dozing, dozing).filter((_, index) => index / 60 > CLICK_SLAM_AT + 0.1);

    expect(Math.min(...wobble.map(({ angle }) => angle))).toBeLessThan(-9);

    // Its clock steps at 30 fps, so the last frame it shows can fall up to a step before the end.
    for (const rest of [standing, dozing, waving]) {
      for (let seconds = CLICK_CLAP_SECONDS - 1 / 30; seconds <= CLICK_CLAP_SECONDS; seconds += 1 / 240) {
        const end = clickClapFrame(seconds, standing, rest);

        expect(Math.abs(end.angle - rest.angle)).toBeLessThan(0.5);
        expect(Math.abs(end.armL - rest.armL)).toBeLessThan(0.5);
        expect(Math.abs(end.armR - rest.armR)).toBeLessThan(0.5);
        expect(end.impact).toBe(0);
      }
    }
  });

  it('opens a shut clapper to clap it, and leaves it shut', () => {
    const shut = { ...standing, angle: 0 };

    expect(clickClapFrame(CLICK_SLAM_AT - 0.14, shut, shut).angle).toBeLessThan(REST_ANGLE);
    expect(clickClapFrame(CLICK_CLAP_SECONDS, shut, shut).angle).toBeCloseTo(0);
  });

  it('is over in under a second', () => {
    expect(CLICK_CLAP_SECONDS).toBeGreaterThan(0.8);
    expect(CLICK_CLAP_SECONDS).toBeLessThanOrEqual(1);
  });
});

describe('clickClapRestarts', () => {
  it('starts a clap on a click, and a new one once the last has landed', () => {
    expect(clickClapRestarts(null)).toBe(true);
    expect(clickClapRestarts(CLICK_SLAM_AT)).toBe(true);
    expect(clickClapRestarts(CLICK_SLAM_AT + 0.4)).toBe(true);
  });

  it('lets a slam that is on its way land, so rapid clicks still clap', () => {
    expect(clickClapRestarts(0)).toBe(false);
    expect(clickClapRestarts(CLICK_SLAM_AT - 0.05)).toBe(false);
  });
});
