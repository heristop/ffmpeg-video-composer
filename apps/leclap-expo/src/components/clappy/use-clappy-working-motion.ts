import { useEffect, useRef } from 'react';
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { VIEW } from '@leclap/creative-kit/clappy';
import { motion } from '@/src/styles/motion';
import {
  CHEER_MS,
  DUST_RUNNER_PX,
  LOOP_MS,
  PUFF_MAX,
  blendPose,
  cheerPose,
  dustPuff,
  runPose,
  strideAt,
  type ClappyPose,
} from './clappy-working-motion';

const never = ReduceMotion.Never;
// He takes a beat to get up to speed, and a little longer to slow down and stand.
const STOP_MS = 450;
// No dust before he has run, or once he has stopped and the clock with him.
const NO_DUST = -1e9;
const DUSTING = 1e9;

/**
 * Clappy trotting in place while a render runs, from one linear UI-thread clock; React never re-renders per
 * frame. Each rise of `cheer` (a progress milestone) layers one cheer over the run. When `running` drops
 * (render done, cancelled, backgrounded, reduced motion) he eases down to standing, then the clock stops.
 */
export function useClappyWorkingMotion(running: boolean, cheer: number, size: number) {
  const clock = useSharedValue(0);
  const amount = useSharedValue(0);
  const phase = useSharedValue(1);
  const stoppedAt = useSharedValue(NO_DUST);
  const lastCheer = useRef(cheer);
  useEffect(() => {
    if (running) {
      cancelAnimation(amount);
      stoppedAt.set(DUSTING);
      clock.set(0);
      clock.set(
        withRepeat(
          withTiming(1, { duration: LOOP_MS, easing: Easing.linear, reduceMotion: never }),
          -1,
          false,
          undefined,
          never
        )
      );
      amount.set(
        withTiming(1, { duration: motion.duration.base, easing: Easing.out(Easing.cubic), reduceMotion: never })
      );
    }

    if (!running && amount.get() !== 0) {
      stoppedAt.set(strideAt(clock.get() * LOOP_MS));
      amount.set(
        withTiming(0, { duration: STOP_MS, easing: Easing.out(Easing.cubic), reduceMotion: never }, (finished) => {
          'worklet';

          if (!finished) return;
          cancelAnimation(clock);
          stoppedAt.set(NO_DUST);
        })
      );
    }
  }, [running, clock, amount, stoppedAt]);
  useEffect(() => {
    const previous = lastCheer.current;
    lastCheer.current = cheer;

    if (!running || cheer <= previous) return;
    const now = phase.get();

    if (now > 0 && now < 1) return;
    phase.set(0);
    phase.set(withTiming(1, { duration: CHEER_MS, easing: Easing.linear, reduceMotion: never }));
  }, [cheer, running, phase]);
  useEffect(
    () => () => {
      cancelAnimation(clock);
      cancelAnimation(amount);
      cancelAnimation(phase);
    },
    [clock, amount, phase]
  );
  const pose = useDerivedValue(() => blendPose(cheerPose(runPose(clock.get() * LOOP_MS), phase.get()), amount.get()));

  const dust = [
    usePuffStyle(0, clock, stoppedAt, size),
    usePuffStyle(1, clock, stoppedAt, size),
    usePuffStyle(2, clock, stoppedAt, size),
  ];

  return { ...useClappyPartStyles(pose, size / VIEW.width), dust };
}

/** One dust puff (web: clappy-runner.tsx Dust), phase-locked to the run clock. */
function usePuffStyle(index: number, clock: SharedValue<number>, stoppedAt: SharedValue<number>, size: number) {
  const k = size / DUST_RUNNER_PX;

  return useAnimatedStyle(() => {
    const puff = dustPuff(strideAt(clock.get() * LOOP_MS), index, stoppedAt.get());

    return {
      opacity: puff.opacity,
      transform: [{ translateX: puff.x * k }, { translateY: -puff.y * k }, { scale: puff.size / PUFF_MAX }],
    };
  });
}

/** One composited transform or opacity per moving part, read off the shared pose. */
function useClappyPartStyles(pose: SharedValue<ClappyPose>, k: number) {
  const body = useAnimatedStyle(() => {
    const p = pose.get();

    return {
      transform: [
        { translateY: p.bob * k },
        { rotate: `${p.lean}deg` },
        { scaleX: p.bodyScaleX },
        { scaleY: p.bodyScaleY },
      ],
    };
  });
  const leftFoot = useAnimatedStyle(() => ({
    transform: [{ translateX: pose.get().leftFootX * k }, { translateY: pose.get().leftFootY * k }],
  }));
  const rightFoot = useAnimatedStyle(() => ({
    transform: [{ translateX: pose.get().rightFootX * k }, { translateY: pose.get().rightFootY * k }],
  }));
  const leftArm = useAnimatedStyle(() => ({ transform: [{ rotate: `${pose.get().armLeft}deg` }] }));
  const rightArm = useAnimatedStyle(() => ({ transform: [{ rotate: `${-pose.get().armRight}deg` }] }));
  const clapper = useAnimatedStyle(() => ({ transform: [{ rotate: `${pose.get().clapper}deg` }] }));
  const eyes = useAnimatedStyle(() => ({
    opacity: 1 - pose.get().happy,
    transform: [{ scaleY: pose.get().blink }],
  }));
  const pupils = useAnimatedStyle(() => ({
    transform: [{ translateX: pose.get().lookX * k }, { translateY: pose.get().lookY * k }],
  }));
  const calm = useAnimatedStyle(() => ({ opacity: 1 - pose.get().happy }));
  const joy = useAnimatedStyle(() => ({ opacity: pose.get().happy }));

  return { body, leftFoot, rightFoot, leftArm, rightArm, clapper, eyes, pupils, calm, joy };
}
