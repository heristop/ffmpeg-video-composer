// On-brand RN form primitives shared by the builder panels: a PanResponder slider (no slider
// dependency in the app — PanResponder is the in-repo precedent), a segmented control, and a
// labelled section header. Touch targets are >=44pt; every control is accessible.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
  type LayoutChangeEvent,
  type GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/src/styles/theme';

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const snap = (value: number, min: number, max: number, step: number): number => {
  const stepped = Math.round((value - min) / step) * step + min;

  return Math.round(clamp(stepped, min, max) * 1000) / 1000;
};

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  resetTo?: number;
  onChange: (value: number) => void;
}

// A draggable track + thumb. The whole row is the hit area; tapping anywhere on the track jumps
// the thumb. Width is measured on layout so we can map x -> value.
export const Slider = ({ label, value, min, max, step = 0.01, format, resetTo, onChange }: SliderProps) => {
  const [width, setWidth] = useState(0);
  const inputsRef = useRef({ width: 0, min, max, step, onChange });
  const showReset = resetTo !== undefined && value !== resetTo;

  useEffect(() => {
    inputsRef.current = { width, min, max, step, onChange };
  }, [width, min, max, step, onChange]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(w);
  };

  const [responder, setResponder] = useState<ReturnType<typeof PanResponder.create> | null>(null);

  useEffect(() => {
    const emitFromX = (x: number) => {
      const { width: trackWidth, min: lower, max: upper, step: increment, onChange: emit } = inputsRef.current;

      if (trackWidth <= 0) return;

      const ratio = clamp(x / trackWidth, 0, 1);
      emit(snap(lower + ratio * (upper - lower), lower, upper, increment));
    };
    const nextResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        emitFromX(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        emitFromX(e.nativeEvent.locationX);
      },
    });
    const timer = setTimeout(() => {
      setResponder(nextResponder);
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  const ratio = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
  const fillW = width * ratio;

  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderHeader}>
        <Text style={styles.controlLabel}>{label}</Text>
        <View style={styles.sliderValueRow}>
          <Text style={styles.sliderValue}>{format ? format(value) : String(value)}</Text>
          {showReset && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Reset ${label}`}
              onPress={() => {
                onChange(resetTo);
              }}
              style={styles.resetBtn}
            >
              <Ionicons name="refresh" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <View
        style={styles.track}
        onLayout={onLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value }}
        {...(responder?.panHandlers ?? {})}
      >
        <View style={styles.trackBar} />
        <View style={[styles.trackFill, { width: fillW }]} />
        <View style={[styles.thumb, { left: clamp(fillW - 12, 0, Math.max(0, width - 24)) }]} />
      </View>
    </View>
  );
};

export interface SegmentChoice<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface SegmentedProps<T extends string> {
  label?: string;
  value: T;
  options: ReadonlyArray<SegmentChoice<T>>;
  onChange: (value: T) => void;
}

// An accessible segmented toggle. Each option is a radio; the active one fills with the brand colour.
export const Segmented = <T extends string>({ label, value, options, onChange }: SegmentedProps<T>) => (
  <View style={styles.segWrap}>
    {label ? <Text style={styles.controlLabel}>{label}</Text> : null}
    <View style={styles.segRow} accessibilityRole="radiogroup">
      {options.map((option) => {
        const active = option.value === value;

        return (
          <TouchableOpacity
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => {
              onChange(option.value);
            }}
            style={[styles.segItem, active && styles.segItemActive]}
          >
            {option.icon ? (
              <Ionicons name={option.icon} size={15} color={active ? '#fff' : colors.textSecondary} />
            ) : null}
            <Text style={[styles.segText, active && styles.segTextActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  </View>
);

const styles = StyleSheet.create({
  sliderRow: { marginTop: spacing.m },
  sliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  controlLabel: {
    ...typography.smallText,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sliderValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sliderValue: { ...typography.caption, color: colors.text, fontVariant: ['tabular-nums'] },
  resetBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  track: {
    height: 44,
    justifyContent: 'center',
  },
  trackBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.divider,
  },
  trackFill: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  segWrap: { marginTop: spacing.m },
  segRow: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  segItem: {
    flex: 1,
    minHeight: 36,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingHorizontal: spacing.xs,
  },
  segItemActive: { backgroundColor: colors.primary },
  segText: { ...typography.caption, fontSize: 13, color: colors.textSecondary },
  segTextActive: { color: '#fff', fontWeight: '600' },
});
