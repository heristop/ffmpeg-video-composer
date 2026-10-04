import { useAdaptiveLayout } from '@/src/hooks/use-adaptive-layout';
import React, { useCallback, useState } from 'react';
import { Platform, View, Text, StyleSheet, FlatList, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Project } from '@/src/types';
import { colors, spacing, typography } from '@/src/styles/theme';
import { elevation } from '@/src/styles/elevation';
import { Clappy } from '@/src/components/clappy/Clappy';
import { PressableScale } from '@/src/components/kinetic/pressable-scale';
import SwipeableProjectItem from '@/src/components/ui/SwipeableProjectItem';
import ConfirmDialog from '@/src/components/ui/dialog/ConfirmDialog';
import { useProjectStore } from '@/src/stores/useProjectStore';
import { useProjectService } from '@/src/presentation/hooks/useProjectService';
import { useCompileProgressStore } from '@/src/stores/useCompileProgressStore';
import { FORM_MAX_WIDTH } from '@/src/styles/adaptive-layout';

function EmptyState() {
  const { t } = useTranslation('projects');
  const focused = useIsFocused();
  const compiling = useCompileProgressStore((s) => s.visible);

  return (
    <View style={styles.emptyContainer}>
      <Clappy size={144} state="welcome" active={focused && !compiling} />
      <Text style={styles.emptyTitle}>{t('empty.title')}</Text>
      <Text style={styles.emptyText}>{t('empty.subtitle')}</Text>
    </View>
  );
}

function useProjectsScreenState() {
  const router = useRouter();
  const { t } = useTranslation('projects');
  const rawProjects = useProjectStore((state) => state.projects);
  const { loadProjects, deleteProject, deleteAllProjects } = useProjectService();
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const projects = (() => {
    // Return a new sorted array (newest first) without mutating the store's array.
    // Spread + sort (Hermes lacks Array.prototype.toSorted).
    return [...rawProjects].sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  })();

  // useFocusEffect keeps `effect` in its dependency array, so the callback MUST be memoized — an
  // inline function re-runs the effect every render, and loadProjects → setProjects then re-renders,
  // spinning a refetch loop that locks the JS thread. loadProjects is now stable, so this runs on focus.
  useFocusEffect(
    useCallback(() => {
      loadProjects().catch(console.error);
    }, [loadProjects])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadProjects()
      .catch(console.error)
      .finally(() => {
        setRefreshing(false);
      });
  };

  const handleDeleteProject = async (projectId: string) => {
    await deleteProject(projectId);
  };

  const handleProjectPress = (project: Project) => {
    if (project.status === 'completed' && project.outputVideoUri) {
      router.push({
        pathname: '/(fullscreen)/preview',
        params: {
          projectId: project.id,
          videoUri: project.outputVideoUri,
        },
      });

      return;
    }

    router.push({
      pathname: '/template/[id]',
      params: {
        id: project.templateName,
        projectId: project.id,
      },
    });
  };

  const handleDeleteAllProjects = () => {
    deleteAllProjects()
      .then(() => {
        setShowDeleteAllDialog(false);
      })
      .catch((error: unknown) => {
        console.error('Error deleting all projects:', error);
        Alert.alert(t('alerts.deleteAllError.title'), t('alerts.deleteAllError.message'));
        setShowDeleteAllDialog(false);
      });
  };

  return {
    projects,
    refreshing,
    showDeleteAllDialog,
    setShowDeleteAllDialog,
    handleRefresh,
    handleDeleteProject,
    handleProjectPress,
    handleDeleteAllProjects,
  };
}

export default function ProjectsScreen() {
  const { navigationRail } = useAdaptiveLayout();
  const router = useRouter();
  const { t } = useTranslation('projects');
  const {
    projects,
    refreshing,
    showDeleteAllDialog,
    setShowDeleteAllDialog,
    handleRefresh,
    handleDeleteProject,
    handleProjectPress,
    handleDeleteAllProjects,
  } = useProjectsScreenState();

  return (
    <SafeAreaView
      edges={Platform.OS === 'android' && navigationRail ? ['left', 'right', 'bottom'] : ['left', 'right']}
      style={styles.container}
    >
      <View style={[styles.innerContainer, { width: '100%', maxWidth: FORM_MAX_WIDTH, alignSelf: 'center' }]}>
        <FlatList
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.titleWrap}>
                <Text accessibilityRole="header" style={styles.screenTitle}>
                  {t('title')}
                </Text>
              </View>

              <PressableScale
                style={styles.createNewButton}
                haptic="medium"
                onPress={() => {
                  router.push('/(app)');
                }}
                accessibilityLabel={t('createNew')}
              >
                <Ionicons name="add-circle" size={22} color={colors.onPrimary} />
                <Text style={styles.createNewButtonText}>{t('createNew')}</Text>
              </PressableScale>
            </View>
          }
          data={projects}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SwipeableProjectItem
              project={item}
              onPress={() => {
                handleProjectPress(item);
              }}
              onDelete={() => handleDeleteProject(item.id)}
            />
          )}
          ListEmptyComponent={<EmptyState />}
          contentContainerStyle={projects.length === 0 ? styles.emptyList : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary, colors.secondary]}
              tintColor={colors.primary}
            />
          }
          windowSize={21}
          maxToRenderPerBatch={5}
          updateCellsBatchingPeriod={50}
          initialNumToRender={10}
        />

        {/* Delete All Confirmation Dialog */}
        <ConfirmDialog
          visible={showDeleteAllDialog}
          title={t('deleteAll.title')}
          message={t('deleteAll.message')}
          confirmText={t('deleteAll.confirm')}
          cancelText={t('actions.cancel', { ns: 'common' })}
          confirmIconName="trash"
          confirmType="danger"
          onConfirm={handleDeleteAllProjects}
          onCancel={() => {
            setShowDeleteAllDialog(false);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  innerContainer: {
    flex: 1,
  },
  header: { paddingTop: spacing.l },
  screenTitle: { ...typography.displayM, color: colors.textStrong },
  titleWrap: {
    marginHorizontal: spacing.m,
    marginBottom: spacing.m,
  },
  createNewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    backgroundColor: colors.primaryDark,
    paddingVertical: spacing.m,
    marginHorizontal: spacing.m,
    marginBottom: spacing.m,
    borderRadius: 14,
    ...elevation.raised,
    shadowOpacity: 0.12,
  },
  createNewButtonText: {
    ...typography.body,
    color: colors.onPrimary,
    fontWeight: '600',
    fontSize: 16,
  },
  list: {
    paddingBottom: spacing.l,
  },
  emptyList: { flexGrow: 1, paddingBottom: spacing.l },
  emptyContainer: { alignItems: 'center', paddingHorizontal: spacing.l, paddingVertical: spacing.xl, gap: spacing.s },
  emptyTitle: {
    ...typography.title,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.m,
    marginBottom: spacing.s,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 320,
  },
});
