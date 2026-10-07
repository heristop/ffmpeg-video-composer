import { useEffect, useId } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  cancelAnimation,
  interpolate,
  Easing,
  ReduceMotion,
} from 'react-native-reanimated';
import { useMotionPreferences } from '@/src/hooks/use-motion-preferences';
import { motion } from '@/src/styles/motion';
import {
  Arm,
  Body,
  Clapper,
  ClappyLayer,
  Dust,
  Face,
  Foot,
  JOINTS,
  Joy,
  Mouth,
  Pupils,
  Whites,
  clappyHeight,
  jointOrigin,
  layerFrame,
  type ClappyState,
} from './clappy-parts';
import { useClappyWorkingMotion } from './use-clappy-working-motion';

export type { ClappyState };

const rotations: Record<ClappyState, number[]> = {
  welcome: [0, -7, 3, 0],
  search: [0, -8, -5, 0],
  error: [0, 2, -2, 0],
  success: [0, -3, 2, 0],
  working: [0, 0, 0, 0],
};
const lifts: Record<ClappyState, number> = { welcome: -0.025, success: -0.045, search: 0, error: 0, working: 0 };

/** The same Clappy as the films and web app. Decorative; accompanying copy carries the state. */
export function Clappy({
  size = 112,
  state = 'welcome',
  active = true,
  cheer = 0,
}: {
  size?: number;
  state?: ClappyState;
  active?: boolean;
  /** While working, each rise (a progress milestone) plays one cheer over the run. */
  cheer?: number;
}) {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const { reducedMotion, appActive } = useMotionPreferences();
  const reaction = useSharedValue(1);
  const moving = active && appActive && !reducedMotion && state !== 'working';
  useEffect(() => {
    reaction.set(1);

    if (moving) {
      reaction.set(0);
      reaction.set(
        withSequence(
          ReduceMotion.Never,
          withTiming(0.35, {
            duration: motion.clappy.anticipate,
            easing: Easing.out(Easing.quad),
            reduceMotion: ReduceMotion.Never,
          }),
          withTiming(0.65, {
            duration: motion.clappy.react,
            easing: Easing.inOut(Easing.quad),
            reduceMotion: ReduceMotion.Never,
          }),
          withTiming(1, {
            duration: motion.clappy.settle,
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.Never,
          })
        )
      );
    }

    return () => {
      cancelAnimation(reaction);
    };
  }, [state, moving, reaction]);
  // Animate the composited wrapper, never the SVG paths or React tree on every frame.
  const animatedStyle = useAnimatedStyle(() => {
    const phase = moving ? reaction.get() : 1;
    const stops = [0, 0.35, 0.65, 1];
    const rotation = rotations[state];
    const lift = size * lifts[state];

    return {
      transform: [
        {
          translateX: interpolate(phase, stops, state === 'search' ? [0, size * 0.025, size * 0.015, 0] : [0, 0, 0, 0]),
        },
        { translateY: interpolate(phase, stops, [0, lift, lift * 0.3, 0]) },
        { rotate: `${interpolate(phase, stops, rotation)}deg` },
        { scale: interpolate(phase, stops, state === 'success' ? [1, 1.06, 1.02, 1] : [1, 1, 1, 1]) },
      ],
    };
  });
  const working = useClappyWorkingMotion(active && appActive && !reducedMotion && state === 'working', cheer, size);
  const frame = layerFrame(size);

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Animated.View style={[{ width: size, height: clappyHeight(size) }, animatedStyle]}>
        <Dust state={state} still={reducedMotion} size={size} styles={working.dust} />
        <Animated.View style={[frame, { transformOrigin: jointOrigin(size, JOINTS.ground) }, working.body]}>
          <ClappyLayer id={`${id}-fl`} size={size} style={working.leftFoot}>
            <Foot cx={222} />
          </ClappyLayer>
          <ClappyLayer id={`${id}-fr`} size={size} style={working.rightFoot}>
            <Foot cx={378} />
          </ClappyLayer>
          <ClappyLayer id={`${id}-l`} size={size} joint={JOINTS.leftShoulder} style={working.leftArm}>
            <Arm id={`${id}-l`} side="left" state={state} />
          </ClappyLayer>
          <ClappyLayer id={`${id}-r`} size={size} joint={JOINTS.rightShoulder} style={working.rightArm}>
            <Arm id={`${id}-r`} side="right" state={state} />
          </ClappyLayer>
          <ClappyLayer id={`${id}-b`} size={size}>
            <Body id={`${id}-b`} />
          </ClappyLayer>
          <ClappyLayer id={`${id}-c`} size={size} joint={JOINTS.hinge} style={working.clapper}>
            <Clapper id={`${id}-c`} />
          </ClappyLayer>
          <ClappyLayer id={`${id}-f`} size={size}>
            <Face id={`${id}-f`} />
          </ClappyLayer>
          <ClappyLayer id={`${id}-m`} size={size} style={working.calm}>
            <Mouth state={state} />
          </ClappyLayer>
          <Animated.View style={[frame, { transformOrigin: jointOrigin(size, JOINTS.eyes) }, working.eyes]}>
            <ClappyLayer id={`${id}-w`} size={size}>
              <Whites state={state} />
            </ClappyLayer>
            <ClappyLayer id={`${id}-p`} size={size} style={working.pupils}>
              <Pupils state={state} />
            </ClappyLayer>
          </Animated.View>
          <ClappyLayer id={`${id}-j`} size={size} style={working.joy}>
            <Joy />
          </ClappyLayer>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
