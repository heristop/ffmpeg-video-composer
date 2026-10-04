// A bottom sheet built on RN Modal (no @gorhom/bottom-sheet in the app). Dismissible via the
// backdrop, the grab handle's close button, or the hardware back button. Content scrolls.
import React, { type ReactNode } from 'react';
import { Modal, View, Text, TouchableWithoutFeedback, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useMotionPreferences } from '@/src/hooks/use-motion-preferences';
import { PressableScale } from '@/src/components/kinetic/pressable-scale';
import { useTranslation } from 'react-i18next';
import { colors, spacing, typography } from '@/src/styles/theme';

interface SheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export const Sheet = ({ visible, title, onClose, children }: SheetProps) => {
  const { reducedMotion } = useMotionPreferences();
  const { t } = useTranslation('preview');

  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'fade' : 'slide'} onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose} accessibilityLabel={t('sheet.dismiss')}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <SafeAreaProvider pointerEvents="box-none">
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeFrame} pointerEvents="box-none">
          <SafeAreaView edges={['bottom']} accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <PressableScale
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('sheet.close')}
                style={styles.closeBtn}
                haptic={false}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </PressableScale>
            </View>
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
            >
              {children}
            </ScrollView>
          </SafeAreaView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  safeFrame: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: spacing.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.divider,
    marginTop: spacing.s,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.l,
    paddingTop: spacing.s,
    paddingBottom: spacing.s,
  },
  title: { ...typography.subtitle, color: colors.text, flex: 1 },
  closeBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: spacing.l },
});
