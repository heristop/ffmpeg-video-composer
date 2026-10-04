import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { buildDescriptionVars } from '@/src/utils/i18nText';
import { UserMediaPicker } from '@/src/features/templates/components/UserMediaPicker';
import { useTemplateDetail } from '@/src/features/templates/detail/use-template-detail';
import { makeGoBack } from '@/src/features/templates/detail/navigation';
import { isCompileDisabled } from '@/src/features/templates/detail/button-label';
import { computeProgress } from '@/src/features/templates/detail/progress';
import { activeMusicSelection } from '@/src/features/templates/detail/header-description';
import { LoadingState, ErrorState } from '@/src/features/templates/detail/components/detail-states';
import { TemplateMasthead } from '@/src/features/templates/detail/components/template-masthead';
import { ProgramStatusStrip } from '@/src/features/templates/detail/components/program-status-strip';
import { ShotList } from '@/src/features/templates/detail/components/shot-list';
import { CreateCta } from '@/src/features/templates/detail/components/create-cta';
import { FormModal } from '@/src/features/templates/detail/modals/form-modal';
import { MusicModal } from '@/src/features/templates/detail/modals/music-modal';
import { styles } from '@/src/features/templates/detail/detail.styles';
import { useAdaptiveLayout } from '@/src/hooks/use-adaptive-layout';
import { CONTENT_MAX_WIDTH } from '@/src/styles/adaptive-layout';

// The compose hub. All state/behaviour lives in useTemplateDetail; this file composes the editorial
// masthead → program status strip → shot-list timeline → signature create CTA, plus the modals.
const TemplateDetailScreen = () => {
  const params = useLocalSearchParams<{ id: string; projectId?: string }>();
  const { sidePanel } = useAdaptiveLayout();
  const {
    template,
    templateLoading,
    templateError,
    projectMissing,
    project,
    filteredSections,
    completedSectionsCount,
    allDone,
    orientation,
    description,
    activeFormSection,
    setActiveFormSection,
    activeMusicSection,
    setActiveMusicSection,
    hasMediaStep,
    mediaPickerVisible,
    setMediaPickerVisible,
    musicChoice,
    backgroundChoice,
    setMusicChoice,
    setBackgroundChoice,
    mediaStepDone,
    qualityTier,
    setQualityTier,
    isPending,
    willQueue,
    handleFormDataChange,
    handleFormSubmit,
    handlePreviewVideo,
    handleSectionPress,
    handleMusicSelect,
    handleMusicUseDefault,
    handleCompile,
    router,
  } = useTemplateDetail(params.id, params.projectId);

  if (templateLoading) {
    return <LoadingState />;
  }

  const goBack = makeGoBack(router);

  // Genuine failure: the template query errored / finished with no such template, or a projectId was
  // passed that resolves to no project (deleted/stale link).
  if (templateError || !template || projectMissing) {
    return <ErrorState error={templateError} onBack={goBack} />;
  }

  // Template is loaded but `project` (local state) is still being set by useProjectInitialization's
  // effect — show the loader instead of flashing "not found" for that one render.
  if (!project) {
    return <LoadingState />;
  }

  const isDisabled = isCompileDisabled(allDone, isPending);
  const { allowedMusic, allowUploadMusic, allowedBackgrounds, allowUploadBackground } = template.content.global ?? {};
  const { totalItems, totalDone } = computeProgress(
    filteredSections,
    completedSectionsCount,
    hasMediaStep,
    mediaStepDone
  );
  const vars = buildDescriptionVars(
    template.content.global?.variables,
    template.content.global?.colorsList,
    project.formData
  );

  return (
    <SafeAreaView style={styles.container}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: CONTENT_MAX_WIDTH,
          alignSelf: 'center',
          flexDirection: sidePanel ? 'row' : 'column',
        }}
      >
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          <TemplateMasthead
            title={template.name.replace('.json', '')}
            description={description}
            orientation={orientation}
            onBack={goBack}
          />
          <ProgramStatusStrip totalDone={totalDone} totalItems={totalItems} />
          <ShotList
            sections={filteredSections}
            project={project}
            vars={vars}
            hasMediaStep={hasMediaStep}
            mediaStepDone={mediaStepDone}
            onSectionPress={handleSectionPress}
            onPreview={handlePreviewVideo}
            onMediaPress={() => {
              setMediaPickerVisible(true);
            }}
          />
        </ScrollView>

        <CreateCta
          sidePanel={sidePanel}
          isDisabled={isDisabled}
          isPending={isPending}
          willQueue={willQueue}
          shotsLeft={totalItems - totalDone}
          qualityTier={qualityTier}
          onQualityTierChange={setQualityTier}
          onCompile={handleCompile}
        />
      </View>

      <FormModal
        section={activeFormSection}
        formData={project.formData}
        onFormDataChange={handleFormDataChange}
        onClose={() => {
          setActiveFormSection(null);
        }}
        onSubmit={handleFormSubmit}
      />
      <MusicModal
        section={activeMusicSection}
        allowedMusic={allowedMusic}
        selectedId={activeMusicSelection(project, activeMusicSection)}
        onSelect={handleMusicSelect}
        onClose={() => {
          setActiveMusicSection(null);
        }}
        onUseDefault={handleMusicUseDefault}
      />
      {hasMediaStep && (
        <UserMediaPicker
          visible={mediaPickerVisible}
          allowedMusic={allowedMusic}
          allowUploadMusic={allowUploadMusic}
          allowedBackgrounds={allowedBackgrounds}
          allowUploadBackground={allowUploadBackground}
          musicChoice={musicChoice}
          backgroundChoice={backgroundChoice}
          onMusicChange={setMusicChoice}
          onBackgroundChange={setBackgroundChoice}
          onClose={() => {
            setMediaPickerVisible(false);
          }}
        />
      )}
    </SafeAreaView>
  );
};

export default TemplateDetailScreen;
