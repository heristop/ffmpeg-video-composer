import { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useCompileProgressStore } from '@/src/stores/useCompileProgressStore';
import { Clappy } from '@/src/components/clappy/Clappy';
import { colors, spacing, typography, withAlpha } from '@/src/styles/theme';
import { useMotionPreferences } from '@/src/hooks/use-motion-preferences';
import { motion } from '@/src/styles/motion';

/** Real engine progress; Clappy holds still while rendering. */
export function CompileProgressOverlay() {
  const { t } = useTranslation('preview');
  const visible = useCompileProgressStore((s) => s.visible);
  const ratio = useCompileProgressStore((s) => s.ratio);
  const stage = useCompileProgressStore((s) => s.stage);
  const cancelling = useCompileProgressStore((s) => s.cancelling);
  const requestCancel = useCompileProgressStore((s) => s.requestCancel);
  const { reducedMotion, appActive } = useMotionPreferences();
  const progress = useSharedValue(ratio);
  useEffect(() => {
    progress.set(
      reducedMotion || !appActive || !visible || cancelling
        ? ratio
        : withTiming(ratio, { duration: motion.duration.instant, reduceMotion: ReduceMotion.Never })
    );

    return () => {
      cancelAnimation(progress);
    };
  }, [ratio, reducedMotion, appActive, visible, cancelling, progress]);
  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));
  const percent = Math.round(ratio * 100);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => {}}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.fill}>
          <ScrollView contentContainerStyle={styles.center}>
            <Clappy size={180} state="working" active={false} />
            <Text accessibilityRole="header" style={styles.heading}>
              {t('compile.title')}
            </Text>
            <Text style={styles.percent}>{percent}%</Text>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={t('compile.progress')}
              accessibilityValue={{ min: 0, max: 100, now: percent }}
              style={styles.track}
            >
              <Animated.View style={[styles.bar, barStyle]} />
            </View>
            <Text accessibilityLiveRegion="polite" style={styles.stage}>
              {cancelling ? t('compile.cancelling') : stage || t('compile.preparing')}
            </Text>
            <View style={styles.privacy}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.monitorSecondary} accessible={false} />
              <Text style={styles.privacyText}>{t('compile.private')}</Text>
            </View>
            <Pressable
              onPress={requestCancel}
              disabled={cancelling}
              accessibilityRole="button"
              accessibilityLabel={t('compile.cancel')}
              accessibilityState={{ disabled: cancelling, busy: cancelling }}
              style={({ pressed }) => [styles.cancel, cancelling && styles.disabled, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>{cancelling ? t('compile.cancelling') : t('compile.cancel')}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.monitorBackground },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.l, gap: spacing.m },
  heading: { ...typography.displayS, color: colors.monitorText, textAlign: 'center', marginTop: spacing.s },
  percent: { ...typography.displayL, color: colors.monitorText, fontVariant: ['tabular-nums'] },
  track: {
    width: '100%',
    maxWidth: 280,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: withAlpha(colors.monitorText, 0.15),
  },
  bar: {
    width: '100%',
    height: '100%',
    transformOrigin: 'left center',
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  stage: { ...typography.body, color: colors.monitorSecondary, lineHeight: 24, textAlign: 'center', minHeight: 48 },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: spacing.m, maxWidth: 320 },
  privacyText: { ...typography.caption, color: colors.monitorSecondary, lineHeight: 20, flexShrink: 1 },
  cancel: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: withAlpha(colors.monitorText, 0.1),
  },
  cancelText: { ...typography.body, color: colors.monitorText, textAlign: 'center' },
  disabled: { opacity: 0.5 },
  pressed: { backgroundColor: withAlpha(colors.monitorText, 0.2) },
});
export default CompileProgressOverlay;
