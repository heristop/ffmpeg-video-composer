import { useAdaptiveLayout } from '@/src/hooks/use-adaptive-layout';
import React from 'react';
import { Platform, View, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';
import TemplateList from '../components/TemplateList';
import { useTemplates } from '@/src/hooks/useTemplates';
import type { Template } from '@/src/types';
import { colors, spacing, typography } from '@/src/styles/theme';
import { TemplateListSkeleton } from '../../../components/ui/SkeletonLoader';
import Button from '../../../components/ui/Button';
import { Clappy } from '@/src/components/clappy/Clappy';
import { PressableScale } from '@/src/components/kinetic/pressable-scale';
import { useCompileProgressStore } from '@/src/stores/useCompileProgressStore';
import { SafeAreaView } from 'react-native-safe-area-context';

interface BrowseTemplatesScreenProps {
  onRecordPress?: () => void;
}

const BrowseTemplatesScreen = ({ onRecordPress: _onRecordPress }: BrowseTemplatesScreenProps) => {
  const { navigationRail } = useAdaptiveLayout();
  const router = useRouter();
  const focused = useIsFocused();
  const compiling = useCompileProgressStore((s) => s.visible);
  const { t } = useTranslation('templates');
  const { data: templates = [], isPending: isLoading, error, refetch } = useTemplates();
  // The catalog is bundled and renders on-device, so being offline never degrades the experience.
  const offlineForUi = false;

  const handleSelectTemplate = (template: Template) => {
    router.push({
      pathname: '/template/[id]',
      params: { id: template.name },
    });
  };

  const goCreateTemplate = () => {
    router.push('/(fullscreen)/create-template');
  };

  if (isLoading && templates.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.screenTitle}>{t('screenTitle')}</Text>
        <Text style={styles.subtitle}>{t('subtitle')}</Text>

        <TemplateListSkeleton count={6} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Clappy state="error" size={128} active={focused && !compiling} />
        <Text style={styles.errorText}>{t('loadError')}</Text>
        <Text style={styles.errorSubtext}>{t('loadErrorHint')}</Text>
        <View style={{ marginTop: spacing.m, alignItems: 'center' }}>
          <Button
            variant="primary"
            onPress={() => {
              refetch().catch(console.error);
            }}
            icon="refresh"
            size="large"
            fullWidth={false}
          >
            {t('actions.tryAgain', { ns: 'common' })}
          </Button>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView
      edges={Platform.OS === 'android' && navigationRail ? ['left', 'right', 'bottom'] : ['left', 'right']}
      style={styles.container}
    >
      <View style={styles.container}>
        <TemplateList
          templates={templates}
          onSelectTemplate={handleSelectTemplate}
          isOffline={offlineForUi}
          onRefresh={() => {
            return refetch().then(() => {});
          }}
          screenTitle={t('screenTitle')}
          subtitle={t('subtitle')}
          motionActive={focused && !compiling}
        />

        <PressableScale
          testID="create-template-fab"
          onPress={goCreateTemplate}
          style={styles.fab}
          haptic="medium"
          accessibilityLabel={t('createTemplate')}
        >
          <Ionicons name="add" size={22} color={colors.onPrimary} />
          <Text style={styles.fabText}>{t('createTemplate')}</Text>
        </PressableScale>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.l,
    backgroundColor: colors.background,
  },
  screenTitle: {
    ...typography.title,
    marginHorizontal: spacing.m,
    marginBottom: spacing.s,
  },
  subtitle: {
    ...typography.caption,
    marginHorizontal: spacing.m,
    marginBottom: spacing.m,
  },
  loadingText: {
    ...typography.body,
    marginTop: spacing.m,
  },
  errorText: {
    ...typography.subtitle,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.m,
  },
  errorSubtext: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: spacing.xl,
    color: colors.textSecondary,
  },
  fab: {
    position: 'absolute',
    right: spacing.l,
    bottom: spacing.l,
    maxWidth: '88%',
    minHeight: 52,
    paddingHorizontal: spacing.m,
    paddingVertical: 12,
    flexDirection: 'row',
    gap: spacing.s,
    borderRadius: 16,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabText: { ...typography.body, color: colors.onPrimary, fontWeight: '600', flexShrink: 1 },
});

export default BrowseTemplatesScreen;
