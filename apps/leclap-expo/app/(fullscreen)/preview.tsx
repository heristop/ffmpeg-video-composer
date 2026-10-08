import React, { useState } from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, withAlpha } from '@/src/styles/theme';
import { PressableScale } from '@/src/components/kinetic/pressable-scale';
import { useProject, useSaveProject } from '@/src/hooks/useProjects';
import { ExportSheet } from '@/src/features/editor/components/ExportSheet';
import CropOverlay from '@/src/features/editor/components/CropOverlay';
import { buildErrorMessage, isCropApplied, isTrimApplied } from '@/src/features/editor/preview/previewHelpers';
import { styles } from '@/src/features/editor/preview/previewStyles';
import { usePreviewPlayer } from '@/src/features/editor/preview/usePreviewPlayer';
import { usePreviewState } from '@/src/features/editor/preview/usePreviewState';
import { usePreviewActions } from '@/src/features/editor/preview/usePreviewActions';
import { useVideoRect } from '@/src/features/editor/preview/useVideoRect';
import { parseOrientation } from '@/src/features/templates/orientationMeta';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PreviewToolbar } from '@/src/features/editor/preview/PreviewToolbar';
import { TrimEditPanel, CropEditPanel, CaptionsEditPanel } from '@/src/features/editor/preview/EditPanels';
import { PreviewLoading, PreviewError, PreviewNoVideo } from '@/src/features/editor/preview/PreviewStates';

// Resolve the guard/early-return screen (loading / error / no-video) before the main editor renders.
// Returns null when the editor itself should render. Kept out of the component to cap its complexity.
function renderPreviewGuard(args: {
  isLoading: boolean;
  errorMessage: string | null;
  project: ReturnType<typeof useProject>['data'];
  videoUri: string | undefined;
  onBack: () => void;
}): React.ReactElement | null {
  const { isLoading, errorMessage, project, videoUri, onBack } = args;

  if (isLoading) {
    return <PreviewLoading />;
  }

  if (errorMessage ?? (!project && !videoUri)) {
    return <PreviewError message={errorMessage ?? 'Preview not available'} onBack={onBack} />;
  }

  if (!videoUri) {
    return <PreviewNoVideo onBack={onBack} />;
  }

  return null;
}

export default function PreviewPage() {
  const params = useLocalSearchParams<{
    projectId?: string;
    videoUri?: string;
    orientation?: 'portrait' | 'landscape' | 'square';
    sectionName?: string;
  }>();
  const router = useRouter();
  const { projectId, videoUri, orientation: paramOrientation, sectionName } = params;

  const { data: project, isLoading: projectLoading, error: projectError } = useProject(projectId ?? '');
  const saveProjectMutation = useSaveProject();

  const requiredOrientation = parseOrientation(paramOrientation);

  const { player, currentTime, duration, srcSize, status } = usePreviewPlayer(videoUri);

  const { mode, crop, trim, setCrop, setTrim, enterMode, cancelMode, applyMode, resetCrop } = usePreviewState({
    player,
    project,
    sectionName,
    duration,
    currentTime,
    status,
  });

  const { canEdit, canCaption, captionsActive, saving, handleRetake, handleDone } = usePreviewActions({
    project,
    projectId,
    sectionName,
    requiredOrientation,
    saveProjectMutation,
    trim,
    crop,
    duration,
  });

  const { videoRect, containerWidth, containerHeight, onContainerLayout } = useVideoRect(srcSize, requiredOrientation);

  const isLoading = projectId ? projectLoading : false;
  const errorMessage = buildErrorMessage(projectError, projectId, videoUri, project);

  const guard = renderPreviewGuard({
    isLoading,
    errorMessage,
    project,
    videoUri,
    onBack: () => {
      router.back();
    },
  });

  if (guard) {
    return guard;
  }

  return (
    <SafeAreaView style={styles.fullscreenContainer}>
      <View style={{ flex: 1 }}>
        <StatusBar hidden translucent backgroundColor="transparent" />

        <View style={styles.videoArea} onLayout={onContainerLayout}>
          {requiredOrientation === 'square' && mode !== 'crop' ? (
            // A square template records portrait, then the engine center-crops to 1:1 — so frame the
            // clip in a 1:1 box with cover here, making the preview match the rendered output.
            <View style={squareStyles.center}>
              <View
                style={[
                  squareStyles.frame,
                  {
                    width: Math.min(containerWidth, containerHeight),
                    height: Math.min(containerWidth, containerHeight),
                  },
                ]}
              >
                <VideoView
                  style={StyleSheet.absoluteFill}
                  player={player}
                  nativeControls={mode === 'view'}
                  contentFit="cover"
                />
              </View>
            </View>
          ) : (
            <VideoView
              style={StyleSheet.absoluteFill}
              player={player}
              nativeControls={mode === 'view'}
              contentFit="contain"
            />
          )}

          {mode === 'crop' && containerWidth > 0 && (
            <CropOverlay videoRect={videoRect} crop={crop} onChange={setCrop} />
          )}

          {mode === 'view' && (
            <PreviewMonitorFrame
              onClose={() => {
                router.back();
              }}
            />
          )}
        </View>

        {mode === 'view' && (
          <PreviewViewControls
            key={videoUri}
            videoUri={videoUri}
            sectionName={sectionName}
            onPause={() => {
              player.pause();
            }}
            saving={saving}
            canEdit={canEdit}
            trimActive={isTrimApplied(trim, duration)}
            cropActive={isCropApplied(crop)}
            onDone={() => {
              handleDone().catch(console.error);
            }}
            onTrim={() => {
              enterMode('trim');
            }}
            onCrop={() => {
              enterMode('crop');
            }}
            onRetake={handleRetake}
            canCaption={canCaption}
            captionsActive={captionsActive}
            onCaptions={() => {
              enterMode('captions');
            }}
          />
        )}

        <CaptionsEditPanel
          visible={mode === 'captions'}
          project={project}
          sectionName={sectionName}
          clipPath={videoUri}
          saveProjectMutation={saveProjectMutation}
          onClose={applyMode}
        />

        {mode === 'trim' && (
          <TrimEditPanel
            duration={duration}
            value={trim}
            currentTime={currentTime}
            onChange={setTrim}
            onSeek={(s) => {
              player.currentTime = s;
            }}
            onCancel={cancelMode}
            onApply={applyMode}
          />
        )}

        {mode === 'crop' && <CropEditPanel onReset={resetCrop} onCancel={cancelMode} onApply={applyMode} />}
      </View>
    </SafeAreaView>
  );
}

function PreviewViewControls({
  videoUri,
  sectionName,
  onPause,
  ...toolbarProps
}: React.ComponentProps<typeof PreviewToolbar> & {
  videoUri?: string;
  sectionName?: string;
  onPause: () => void;
}) {
  const [exportVisible, setExportVisible] = useState(false);
  const canExport = Boolean(videoUri && !sectionName);

  return (
    <>
      <PreviewToolbar
        {...toolbarProps}
        onExport={
          canExport
            ? () => {
                onPause();
                setExportVisible(true);
              }
            : undefined
        }
      />
      {canExport && videoUri ? (
        <ExportSheet
          visible={exportVisible}
          videoUri={videoUri}
          onClose={() => {
            setExportVisible(false);
          }}
        />
      ) : null}
    </>
  );
}

// Program-monitor framing over the finished render: registration brackets + a PROGRAM tally, plus an
// explicit close affordance. Brackets/tally are non-interactive so the native video controls stay
// usable; only the close button captures touches. Shown in `view` mode only (not trim/crop).
function PreviewMonitorFrame({ onClose }: { onClose: () => void }) {
  return (
    <>
      <View pointerEvents="none" style={monitorStyles.frame}>
        <View style={[monitorStyles.bracket, monitorStyles.tl]} />
        <View style={[monitorStyles.bracket, monitorStyles.tr]} />
        <View style={[monitorStyles.bracket, monitorStyles.bl]} />
        <View style={[monitorStyles.bracket, monitorStyles.br]} />
        <View style={monitorStyles.chip}>
          <View style={monitorStyles.chipDot} />
          <Text style={monitorStyles.chipText}>PROGRAM</Text>
        </View>
      </View>
      <PressableScale style={monitorStyles.close} onPress={onClose} accessibilityLabel="Close preview">
        <Ionicons name="chevron-down" size={26} color="#FFFFFF" />
      </PressableScale>
    </>
  );
}

const squareStyles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frame: { width: '100%', aspectRatio: 1, overflow: 'hidden', backgroundColor: 'black' },
});

const monitorStyles = StyleSheet.create({
  frame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, margin: 20, zIndex: 3 },
  bracket: { position: 'absolute', width: 26, height: 26, borderColor: withAlpha('#FFFFFF', 0.5) },
  tl: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 8 },
  tr: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 8 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 8 },
  br: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 8 },
  chip: {
    position: 'absolute',
    top: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error },
  chipText: { fontFamily: fonts.poppins.semiBold, fontSize: 10, letterSpacing: 1.5, color: '#FFFFFF' },
  close: {
    position: 'absolute',
    top: 16,
    left: 20,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 4,
  },
});
