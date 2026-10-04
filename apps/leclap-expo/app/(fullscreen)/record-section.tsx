import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, StatusBar, Alert } from 'react-native';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { VideoFile } from 'react-native-vision-camera';
import VideoRecorder from '@/src/features/editor/components/VideoRecorder';
import type { Section, Orientation } from '@/src/types';
import { EDITABLE_TYPES } from '@/src/features/templates/detail/section-status';
import { parseOrientation, toDeviceOrientation } from '@/src/features/templates/orientationMeta';
import { colors, spacing, fonts, typography, withAlpha } from '@/src/styles/theme';
import { PressableScale } from '@/src/components/kinetic/pressable-scale';
import { useProject, useSaveProject } from '@/src/hooks/useProjects';
import { useOrientation } from '@/src/hooks/useOrientation';
import { useAdaptiveLayout } from '@/src/hooks/use-adaptive-layout';

const safeJsonParse = (jsonString: string | undefined | null): unknown => {
  if (!jsonString) return null;

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Failed to parse JSON string:', error);

    return null;
  }
};

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

interface RecordSectionHeaderProps {
  section: Section;
  isRecording: boolean;
  // Back is also blocked while the stopped clip finalizes, so navigation can't fire mid-save.
  backDisabled: boolean;
  recordingDuration: number;
  shotIndex?: number;
  shotTotal: number;
  onBack: () => void;
  t: TFunction<'recording'>;
}

const pad = (n: number): string => String(n).padStart(2, '0');

const RecordSectionHeader = ({
  section,
  isRecording,
  backDisabled,
  recordingDuration,
  shotIndex,
  shotTotal,
  onBack,
  t,
}: RecordSectionHeaderProps) => {
  return (
    <View style={styles.headerBar}>
      <PressableScale
        style={styles.headerBack}
        onPress={onBack}
        disabled={backDisabled}
        accessibilityLabel={t('actions.back', { ns: 'common' })}
      >
        <Ionicons name="chevron-back" size={26} color={backDisabled ? 'rgba(255,255,255,0.4)' : '#FFFFFF'} />
      </PressableScale>

      <View style={styles.headerTitleContainer}>
        {shotIndex ? (
          <Text style={styles.shotBadge}>
            {t('shot', { defaultValue: 'SHOT' })} {pad(shotIndex)} / {pad(shotTotal)}
          </Text>
        ) : null}
        <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
          {section.title?.en ?? section.name}
        </Text>
      </View>

      {isRecording ? (
        <View style={styles.timerContainer}>
          <MotiView
            from={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            transition={{ loop: true, repeatReverse: true, type: 'timing', duration: 700 }}
            style={styles.recordingIndicator}
          />
          <Text style={styles.timerText}>{formatTime(recordingDuration)}</Text>
        </View>
      ) : (
        <View style={styles.headerBack} />
      )}
    </View>
  );
};

const buildUpdatedProject = (
  project: NonNullable<ReturnType<typeof useProject>['data']>,
  section: Section,
  video: VideoFile,
  orientation: Orientation
) => {
  const isFirstSectionRecorded = Object.keys(project.recordedVideos).length === 0;

  const updatedProject = {
    ...project,
    recordedVideos: {
      ...project.recordedVideos,
      [section.name]: {
        path: video.path,
        orientation: orientation,
        duration: (video as unknown as { duration?: number }).duration,
        width: (video as unknown as { width?: number }).width,
        height: (video as unknown as { height?: number }).height,
        recordedAt: new Date().toISOString(),
      },
    },
    updatedAt: new Date().toISOString(),
  };

  if (isFirstSectionRecorded) {
    updatedProject.thumbnailUri = video.path;
  }

  return updatedProject;
};

const useOrientationLock = (orientation: 'portrait' | 'landscape', enabled: boolean) => {
  // `orientation` here is the DEVICE orientation (square already mapped to portrait by the caller).
  const { lockOrientation, unlockOrientation } = useOrientation();

  useEffect(() => {
    if (enabled) lockOrientation(orientation).catch(console.error);

    return () => {
      if (enabled) unlockOrientation().catch(console.error);
    };
  }, [orientation, enabled, lockOrientation, unlockOrientation]);
};

const useRecordingTimer = (isRecording: boolean) => {
  const [recordingDuration, setRecordingDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    }

    if (!isRecording) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRecordingDuration(0);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  return recordingDuration;
};

interface NavigateAfterRecordingParams {
  router: ReturnType<typeof useRouter>;
  project: NonNullable<ReturnType<typeof useProject>['data']>;
  section: Section;
  video: VideoFile;
  projectId: string;
  orientation: Orientation;
}

const navigateAfterRecording = ({
  router,
  project,
  section,
  video,
  projectId,
  orientation,
}: NavigateAfterRecordingParams) => {
  const backToEditor = () => {
    router.replace({ pathname: '/template/[id]', params: { id: project.templateName, projectId: project.id } });
  };

  const sections = project.templateContent.sections ?? [];
  const currentSectionIndex = sections.findIndex((s: Section) => s.name === section.name);

  // Only return to the editor when we can POSITIVELY confirm this was the last section
  // (so the user can hit "Create video"). In every other case — including when the section
  // isn't found because the project's stored template diverged from the live one — send the
  // user to the preview screen so they can review / trim / crop the clip they just recorded.
  const isLastSection = currentSectionIndex !== -1 && currentSectionIndex === sections.length - 1;

  if (isLastSection) {
    backToEditor();

    return;
  }

  router.push({
    pathname: '/(fullscreen)/preview',
    // Preserve the template aspect ratio independently of the preview window orientation.
    params: {
      projectId,
      videoUri: video.path,
      orientation,
      sectionName: section.name,
    },
  });
};

// "SHOT n / total" position of this section within the template, for the capture header badge.
const shotPosition = (
  project: ReturnType<typeof useProject>['data'],
  sectionName: string
): { shotIndex?: number; shotTotal: number } => {
  // Count only the sections a viewer fills in, matching the detail hub's shot list (EDITABLE_TYPES /
  // getSectionInfo). Authored colour/text cards aren't shots — including them would misnumber the badge.
  const sections = (project?.templateContent.sections ?? []).filter((s: Section) =>
    (EDITABLE_TYPES as readonly string[]).includes(s.type)
  );
  const index = sections.findIndex((s: Section) => s.name === sectionName);

  return { shotIndex: index >= 0 ? index + 1 : undefined, shotTotal: sections.length };
};

const RecordSectionScreen = () => {
  const router = useRouter();
  const { t } = useTranslation('recording');
  const params = useLocalSearchParams<{
    projectId: string;
    sectionJson: string;
    orientation?: string;
    existingVideoPath?: string;
  }>();

  const { projectId, existingVideoPath } = params;
  const section = safeJsonParse(params.sectionJson) as Section | null;
  const orientation: Orientation = parseOrientation(params.orientation);

  const { data: project } = useProject(projectId);
  const saveProjectMutation = useSaveProject();

  const [isRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const recordingDuration = useRecordingTimer(isRecording);

  const { usableWidth, usableHeight } = useAdaptiveLayout();
  // Capture may request orientation on phones; large, unfolded, and multitasking windows stay free.
  useOrientationLock(toDeviceOrientation(orientation), Math.min(usableWidth, usableHeight) < 600);

  if (!projectId || !section) {
    console.error('RecordSectionScreen: Missing projectId or section data');
    Alert.alert(t('alerts.loadError.title'), t('alerts.loadError.message'), [
      {
        text: t('actions.ok', { ns: 'common' }),
        onPress: () => {
          router.back();
        },
      },
    ]);

    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{t('loadingError')}</Text>
      </View>
    );
  }

  const handleVideoRecorded = async (video: VideoFile) => {
    if (!project) return;

    try {
      const updatedProject = buildUpdatedProject(project, section, video, orientation);

      await saveProjectMutation.mutateAsync(updatedProject);
      navigateAfterRecording({ router, project, section, video, projectId, orientation });
    } catch (error) {
      console.error('Error saving recorded video:', error);
      Alert.alert(t('alerts.saveError.title'), t('alerts.saveError.message'));
    }
  };

  const position = shotPosition(project, section.name);

  return (
    <SafeAreaView style={styles.fullscreenContainer}>
      <View style={styles.fullscreenContainer}>
        <StatusBar hidden />

        <RecordSectionHeader
          section={section}
          isRecording={isRecording}
          backDisabled={isRecording || isFinalizing}
          recordingDuration={recordingDuration}
          shotIndex={position.shotIndex}
          shotTotal={position.shotTotal}
          onBack={() => {
            router.back();
          }}
          t={t}
        />

        <VideoRecorder
          orientation={orientation}
          onVideoRecorded={(video) => {
            handleVideoRecorded(video).catch(console.error);
          }}
          existingVideoUri={existingVideoPath}
          sectionDescription={section.description?.en}
          countdownSeconds={section.options?.countdown ? (section.options.countdownDuration ?? 4) : undefined}
          maxDurationSeconds={section.options?.duration}
          framingGuide={section.options?.framingGuide}
          onFinalizingChange={setIsFinalizing}
          fullscreen
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#000',
    position: 'relative',
  },
  headerBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    minHeight: 60,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
  },
  headerBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 10,
  },
  shotBadge: {
    color: withAlpha('#FFFFFF', 0.72),
    fontFamily: fonts.poppins.semiBold,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: 2,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontFamily: fonts.poppins.semiBold,
    fontSize: 17,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    zIndex: 6,
  },
  timerText: {
    color: '#FFFFFF',
    fontFamily: fonts.poppins.medium,
    fontSize: 15,
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  recordingIndicator: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.error,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
  },
});

export default RecordSectionScreen;
