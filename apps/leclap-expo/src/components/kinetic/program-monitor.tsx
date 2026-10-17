import { type ReactNode } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, withAlpha } from '@/src/styles/theme';
import { gradients } from '@/src/styles/gradients';
import { GradientMeter } from '@/src/components/kinetic/gradient-meter';

type MonitorAspect = 'portrait' | 'landscape' | 'square' | number;

const ASPECT_RATIO: Record<'portrait' | 'landscape' | 'square', number> = {
  portrait: 9 / 16,
  landscape: 16 / 9,
  square: 1,
};

interface ProgramMonitorProps {
  children: ReactNode;
  aspect?: MonitorAspect;
  label?: string;
  showTicks?: boolean;
  progress?: number; // 0..1 → renders a playhead scrubber along the bottom
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
}

function MonitorDecorations({
  showTicks,
  label,
  progress,
  dark,
  bracketColor,
}: Pick<ProgramMonitorProps, 'showTicks' | 'label' | 'progress' | 'dark'> & { bracketColor: string }) {
  return (
    <>
      {showTicks ? (
        <>
          <View style={[styles.bracket, styles.tl, { borderColor: bracketColor }]} />
          <View style={[styles.bracket, styles.tr, { borderColor: bracketColor }]} />
          <View style={[styles.bracket, styles.bl, { borderColor: bracketColor }]} />
          <View style={[styles.bracket, styles.br, { borderColor: bracketColor }]} />
        </>
      ) : null}
      {label ? (
        <View style={[styles.chip, { backgroundColor: withAlpha(dark ? '#000000' : colors.textStrong, 0.55) }]}>
          <View style={styles.chipDot} />
          <Text style={styles.chipText}>{label}</Text>
        </View>
      ) : null}
      {progress === undefined ? null : (
        <View style={styles.scrubber}>
          <GradientMeter progress={progress} variant="playhead" size={4} colorStops={gradients.brand} />
        </View>
      )}
    </>
  );
}

const monitorRatio = (aspect: MonitorAspect) => (typeof aspect === 'number' ? aspect : ASPECT_RATIO[aspect]);
const monitorColors = (dark: boolean) => ({
  frame: dark ? withAlpha('#FFFFFF', 0.16) : colors.hairline,
  bracket: dark ? withAlpha('#FFFFFF', 0.5) : withAlpha(colors.primary, 0.6),
});

// Frames a preview like a video deck's program monitor: a hairline frame, corner registration
// brackets, an optional `PROGRAM` tally chip and (when `progress` is given) a playhead scrubber. Light
// by default; `dark` switches to the render-theater surface for the compile/preview stage.
export function ProgramMonitor({
  children,
  aspect = 'portrait',
  label = 'PROGRAM',
  showTicks = true,
  progress,
  dark = false,
  style,
}: ProgramMonitorProps) {
  const ratio = monitorRatio(aspect);
  const { frame: frameColor, bracket: bracketColor } = monitorColors(dark);

  return (
    <View style={[styles.wrap, { aspectRatio: ratio, borderColor: frameColor }, style]}>
      <View style={styles.screen}>{children}</View>

      <MonitorDecorations
        showTicks={showTicks}
        label={label}
        progress={progress}
        dark={dark}
        bracketColor={bracketColor}
      />
    </View>
  );
}

const BRACKET = 16;

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    backgroundColor: '#000000',
    position: 'relative',
  },
  screen: { flex: 1 },
  bracket: { position: 'absolute', width: BRACKET, height: BRACKET },
  tl: { top: 10, left: 10, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 6 },
  tr: { top: 10, right: 10, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 6 },
  bl: { bottom: 10, left: 10, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 6 },
  br: { bottom: 10, right: 10, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 6 },
  chip: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error },
  chipText: {
    fontFamily: fonts.poppins.semiBold,
    fontSize: 10,
    letterSpacing: 1.5,
    color: '#FFFFFF',
  },
  scrubber: { position: 'absolute', left: 14, right: 14, bottom: 14 },
});

export default ProgramMonitor;
