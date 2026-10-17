import { useEffect, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { gradients, gradientDir } from '@/src/styles/gradients';
import { colors, withAlpha } from '@/src/styles/theme';
import { motion } from '@/src/styles/motion';
import { arcRadius, circumference, dashOffset, barFill, clamp01 } from '@/src/components/kinetic/gradient-meter.logic';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function animateSharedValue(value: SharedValue<number>, target: number, duration: number): void {
  value.value = withTiming(target, { duration });
}

type MeterVariant = 'bar' | 'playhead' | 'arc';

interface GradientMeterProps {
  progress: number; // 0..1
  variant?: MeterVariant;
  size?: number; // arc diameter, or track height for bar/playhead
  stroke?: number; // arc stroke width
  colorStops?: readonly [string, string];
  trackColor?: string;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

// The progress vocabulary shared across the app — the same lavender→pink fill as the compile ring,
// expressed as a slim `bar`, a `playhead` scrubber (bar + a riding tick) or an `arc` (the ring). One
// component so the hub meter, the preview scrubber and the render ring read as one family.
export function GradientMeter({
  progress,
  variant = 'bar',
  size,
  stroke = 6,
  colorStops = gradients.brand,
  trackColor = withAlpha(colors.primary, 0.14),
  duration = motion.duration.ring,
  style,
}: GradientMeterProps) {
  if (variant === 'arc') {
    return (
      <ArcMeter
        progress={progress}
        size={size ?? 120}
        stroke={stroke}
        colorStops={colorStops}
        trackColor={trackColor}
        duration={duration}
        style={style}
      />
    );
  }

  return (
    <LinearMeter
      progress={progress}
      height={size ?? 6}
      colorStops={colorStops}
      trackColor={trackColor}
      duration={duration}
      showThumb={variant === 'playhead'}
      style={style}
    />
  );
}

interface LinearMeterProps {
  progress: number;
  height: number;
  colorStops: readonly [string, string];
  trackColor: string;
  duration: number;
  showThumb: boolean;
  style?: StyleProp<ViewStyle>;
}

function LinearMeter({ progress, height, colorStops, trackColor, duration, showThumb, style }: LinearMeterProps) {
  const [width, setWidth] = useState(0);
  const fill = useSharedValue(0);

  useEffect(() => {
    animateSharedValue(fill, barFill(width, progress), duration);
  }, [width, progress, duration, fill]);

  const fillStyle = useAnimatedStyle(() => ({ width: fill.value }));
  const thumbStyle = useAnimatedStyle(() => ({ left: fill.value }));

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  };

  return (
    <View
      style={[{ height, borderRadius: height, backgroundColor: trackColor }, styles.track, style]}
      onLayout={onLayout}
    >
      <Animated.View style={[styles.fill, fillStyle]}>
        <LinearGradient colors={[...colorStops]} {...gradientDir.horizontal} style={StyleSheet.absoluteFill} />
      </Animated.View>
      {showThumb && (
        <Animated.View style={[styles.thumbWrap, thumbStyle]}>
          <View style={[styles.thumb, { borderColor: colorStops[1] }]} />
        </Animated.View>
      )}
    </View>
  );
}

interface ArcMeterProps {
  progress: number;
  size: number;
  stroke: number;
  colorStops: readonly [string, string];
  trackColor: string;
  duration: number;
  style?: StyleProp<ViewStyle>;
}

function ArcMeter({ progress, size, stroke, colorStops, trackColor, duration, style }: ArcMeterProps) {
  const radius = arcRadius(size, stroke);
  const circ = circumference(radius);
  const value = useSharedValue(0);

  useEffect(() => {
    animateSharedValue(value, clamp01(progress), duration);
  }, [progress, duration, value]);

  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: dashOffset(circ, value.value) }));

  return (
    <Svg width={size} height={size} style={[styles.arc, style]}>
      <Defs>
        <SvgGradient id="meterArc" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colorStops[0]} />
          <Stop offset="1" stopColor={colorStops[1]} />
        </SvgGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={stroke} fill="none" />
      <AnimatedCircle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="url(#meterArc)"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circ}
        animatedProps={arcProps}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'visible', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999, overflow: 'hidden' },
  thumbWrap: { position: 'absolute', top: '50%' },
  thumb: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    marginTop: -6,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 2,
  },
  arc: { transform: [{ rotate: '-90deg' }] },
});

export default GradientMeter;
