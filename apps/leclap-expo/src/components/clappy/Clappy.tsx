import { useEffect, useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';
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
  ARM,
  BOARD,
  BOARD_BOTTOM,
  BOARD_TOP,
  CHEEK,
  DOT,
  OUTLINE,
  PUPIL,
  STRIPE_PERI,
  STRIPE_YELLOW,
  VIEW,
} from '@leclap/creative-kit/clappy';

export type ClappyState = 'welcome' | 'working' | 'success' | 'search' | 'error';

const rotations: Record<ClappyState, number[]> = {
  welcome: [0, -7, 3, 0],
  search: [0, -8, -5, 0],
  error: [0, 2, -2, 0],
  success: [0, -3, 2, 0],
  working: [0, 0, 0, 0],
};
const lifts: Record<ClappyState, number> = { welcome: -0.025, success: -0.045, search: 0, error: 0, working: 0 };
const mouths: Record<ClappyState, string> = {
  welcome: 'M278 442 Q289 458 300 445 Q311 458 322 442',
  search: 'M278 442 Q289 458 300 445 Q311 458 322 442',
  error: 'M280 458 Q300 438 320 458',
  working: 'M286 452 L314 452',
  success: '',
};

/** The same Clappy as the films and web app. Decorative; accompanying copy carries the state. */
export function Clappy({
  size = 112,
  state = 'welcome',
  active = true,
}: {
  size?: number;
  state?: ClappyState;
  active?: boolean;
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
  const proud = state === 'success';
  const focused = state === 'working';
  const gradient = `url(#${id}-board)`;
  const leftArm = state === 'welcome' || proud ? 130 : 50;
  const rightArm = proud ? 130 : 50;

  const stick = (y: number) => (
    <G>
      <Rect x={137} y={y + 5} width={372} height={58} rx={18} fill={`url(#${id}-stripes)`} />
      <Rect
        x={132}
        y={y}
        width={372}
        height={58}
        rx={18}
        fill="none"
        stroke={OUTLINE}
        strokeWidth={22}
        strokeLinejoin="round"
      />
    </G>
  );

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Animated.View style={[{ width: size, height: (size * VIEW.height) / VIEW.width }, animatedStyle]}>
        <Svg
          width={size}
          height={(size * VIEW.height) / VIEW.width}
          viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
        >
          <Defs>
            <LinearGradient id={`${id}-board`} x1="0" y1="0" x2="0" y2="1">
              <Stop stopColor={BOARD_TOP} />
              <Stop offset="1" stopColor={BOARD_BOTTOM} />
            </LinearGradient>
            <Pattern
              id={`${id}-stripes`}
              width={96}
              height={96}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-26)"
            >
              <Rect width={96} height={96} fill={STRIPE_YELLOW} />
              <Rect x={48} width={48} height={96} fill={STRIPE_PERI} />
            </Pattern>
          </Defs>
          {[222, 378].map((cx) => (
            <G key={cx}>
              <Ellipse cx={cx + 4} cy={528} rx={44} ry={22} fill={BOARD_BOTTOM} />
              <Ellipse cx={cx} cy={524} rx={44} ry={22} fill="none" stroke={OUTLINE} strokeWidth={13} />
            </G>
          ))}
          {[
            [98, leftArm],
            [502, -rightArm],
          ].map(([x, angle]) => (
            <G key={x} transform={`translate(${x} 344) rotate(${angle})`}>
              <Path d={ARM} fill={gradient} transform="translate(4 4)" />
              <Path d={ARM} fill="none" stroke={OUTLINE} strokeWidth={13} strokeLinejoin="round" />
            </G>
          ))}
          <Path d={BOARD} fill={gradient} transform="translate(6 5)" />
          <Path d={BOARD} fill="none" stroke={OUTLINE} strokeWidth={22} strokeLinejoin="round" />
          {stick(252)}
          <G transform={`rotate(${focused ? -12 : -25} 140 250)`}>{stick(192)}</G>
          <Rect x={95} y={221} width={80} height={96} rx={24} fill={gradient} />
          <Rect x={90} y={216} width={80} height={96} rx={24} fill="none" stroke={OUTLINE} strokeWidth={22} />
          <Circle cx={130} cy={264} r={17} fill={DOT} stroke={OUTLINE} strokeWidth={7} />
          {[240, 360].map((cx) =>
            proud ? (
              <Path
                key={cx}
                d={`M${cx - 26} 406 Q${cx} 378 ${cx + 26} 406`}
                fill="none"
                stroke={OUTLINE}
                strokeWidth={10}
                strokeLinecap="round"
              />
            ) : (
              <G key={cx} transform={`translate(${cx} 396) scale(1 ${focused ? 0.82 : 1})`}>
                <Ellipse rx={33} ry={38} fill={DOT} stroke={OUTLINE} strokeWidth={9} />
                <Ellipse cx={state === 'search' ? 8 : 0} cy={3} rx={22} ry={25} fill={PUPIL} />
                <Circle cx={9} cy={-8} r={9} fill={DOT} />
                <Circle cx={-8} cy={13} r={4.5} fill={DOT} />
              </G>
            )
          )}
          {[186, 414].map((cx) => (
            <Ellipse key={cx} cx={cx} cy={444} rx={27} ry={14} fill={CHEEK} opacity={0.6} />
          ))}
          {proud ? (
            <G>
              <Path d="M274 440 Q300 480 326 440 Z" fill={PUPIL} stroke={OUTLINE} strokeWidth={7} />
              <Path d="M287 458 Q300 471 313 458 Q300 463 287 458 Z" fill={CHEEK} />
            </G>
          ) : (
            <Path d={mouths[state]} fill="none" stroke={OUTLINE} strokeWidth={9} strokeLinecap="round" />
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}
