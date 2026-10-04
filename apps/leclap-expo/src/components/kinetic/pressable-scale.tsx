import { useEffect, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle, type AccessibilityRole } from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { motion } from '@/src/styles/motion';
import { useHapticPress, type HapticStyle } from '@/src/hooks/use-haptic-press';
import { useMotionPreferences } from '@/src/hooks/use-motion-preferences';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps {
  children: ReactNode;
  onPress?: () => void | Promise<void>;
  onLongPress?: () => void;
  scaleTo?: number;
  haptic?: HapticStyle;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: { disabled?: boolean; selected?: boolean; checked?: boolean };
  testID?: string;
}

// Tactile tap for anything that isn't a Tamagui Button — cards, tiles, rows, the record button. Dips
// on press with the shared `tap` spring and fires a haptic. The scale lives on the UI thread so it
// stays smooth inside scroll views.
export function PressableScale({
  children,
  onPress,
  onLongPress,
  scaleTo = 0.96,
  haptic = 'light',
  disabled = false,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  testID,
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const pressed = useSharedValue(false);
  const { reducedMotion, appActive } = useMotionPreferences();
  const animate = !reducedMotion && appActive;
  const handlePress = useHapticPress(onPress, haptic);
  useEffect(() => {
    if (!animate || disabled) {
      cancelAnimation(scale);
      scale.set(1);
    }

    if (disabled || !appActive) pressed.set(false);

    return () => {
      cancelAnimation(scale);
    };
  }, [animate, disabled, appActive, scale, pressed]);
  const animatedStyle = useAnimatedStyle(() => {
    let opacity = pressed.get() ? 0.8 : 1;

    if (disabled) opacity = 0.5;

    return { transform: [{ scale: animate && !disabled ? scale.get() : 1 }], opacity };
  });

  return (
    <AnimatedPressable
      onPressIn={() => {
        if (disabled) return;

        pressed.set(true);
        scale.set(animate ? withSpring(scaleTo, { ...motion.spring.tap, reduceMotion: ReduceMotion.Never }) : 1);
      }}
      onPressOut={() => {
        pressed.set(false);
        scale.set(animate ? withSpring(1, { ...motion.spring.tap, reduceMotion: ReduceMotion.Never }) : 1);
      }}
      onPress={disabled ? undefined : handlePress}
      onLongPress={disabled ? undefined : onLongPress}
      disabled={disabled}
      style={[style, animatedStyle]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled, ...accessibilityState }}
      testID={testID}
    >
      {children}
    </AnimatedPressable>
  );
}

export default PressableScale;
