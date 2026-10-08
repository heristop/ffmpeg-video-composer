import { useState, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import type { Template, Section, Project, MediaChoice, MediaChoices } from '@/src/types';
import type { QualityTier } from 'ffmpeg-video-composer/src/core/encoding.ts';
import { useTemplate } from '@/src/hooks/useTemplates';
import { useProject, useSaveProject } from '@/src/hooks/useProjects';
import { useOnDeviceCompilation } from '@/src/hooks/useOnDeviceCompilation';
import { needsMediaStep } from '@/src/services/media/mediaStepHelpers';
import { getSectionInfo } from '@/src/features/templates/detail/section-status';
import { computeAllDone } from '@/src/features/templates/detail/progress';
import { compileTemplate } from '@/src/features/templates/detail/compile-template';
import { applyCaptionPins } from '@/src/features/captions/caption-store';
import { buildHeaderDescription, defaultMusicChoice } from '@/src/features/templates/detail/header-description';

type HandlerCtx = {
  project: Project | null;
  template: Template | undefined;
  activeFormSection: Section | null;
  activeMusicSection: Section | null;
  setProject: (p: Project) => void;
  setActiveFormSection: (s: Section | null) => void;
  setActiveMusicSection: (s: Section | null) => void;
  saveProjectMutation: ReturnType<typeof useSaveProject>;
  router: ReturnType<typeof useRouter>;
};

function useSectionHandlers(ctx: HandlerCtx) {
  const { t } = useTranslation('detail');
  const {
    project,
    template,
    activeFormSection,
    activeMusicSection,
    setProject,
    setActiveFormSection,
    setActiveMusicSection,
    saveProjectMutation,
    router,
  } = ctx;
  const handleFormDataChange = (field: string, value: string) => {
    if (!project) return;
    setProject({ ...project, formData: { ...project.formData, [field]: value }, updatedAt: new Date().toISOString() });
    saveProjectMutation.mutate({
      ...project,
      formData: { ...project.formData, [field]: value },
      updatedAt: new Date().toISOString(),
    });
  };
  const handleFormSubmit = () => {
    if (!activeFormSection || !project) return;
    const done = (activeFormSection.options?.fields ?? []).every((f) => Boolean(project.formData[f.name]));

    if (done) {
      setActiveFormSection(null);

      return;
    }

    Alert.alert(t('alerts.incompleteForm.title'), t('alerts.incompleteForm.message'));
  };
  const handlePreviewVideo = (section: Section) => {
    if (project?.recordedVideos[section.name] && template?.content.global?.orientation) {
      router.push({
        pathname: '/(fullscreen)/preview',
        params: {
          projectId: project.id,
          videoUri: project.recordedVideos[section.name].path,
          orientation: template.content.global.orientation,
          sectionName: section.name,
        },
      });

      return;
    }
    console.error('Cannot preview video: Missing project, video, or orientation data.');
    Alert.alert(t('alerts.error.title'), t('alerts.error.message'));
  };
  const handleSectionPress = (section: Section) => {
    if (!project || !template) return;

    if (section.type === 'project_video' || section.type === 'picture') {
      router.push({
        pathname: '/(fullscreen)/record-section',
        params: {
          projectId: project.id,
          sectionJson: JSON.stringify(section),
          orientation: template.content.global?.orientation ?? 'portrait',
          existingVideoPath: project.recordedVideos[section.name]?.path,
        },
      });

      return;
    }

    if (section.type === 'form') {
      setActiveFormSection(section);

      return;
    }

    if (section.type === 'music') {
      setActiveMusicSection(section);

      return;
    }

    Alert.alert(t('alerts.unsupported.title'), t('alerts.unsupported.message'));
  };
  // Persist the chosen track id (or 'default') for the active music section, keeping the modal open
  // so the selection's checkmark updates in place — the user dismisses with Done/close.
  const selectMusic = (id: string) => {
    if (!project || !activeMusicSection) return;

    const updated = {
      ...project,
      formData: { ...project.formData, [`music_${activeMusicSection.name}`]: id },
      updatedAt: new Date().toISOString(),
    };
    setProject(updated);
    saveProjectMutation.mutate(updated);
  };

  const handleMusicSelect = (id: string) => {
    selectMusic(id);
  };

  const handleMusicUseDefault = () => {
    if (project && activeMusicSection && !project.formData[`music_${activeMusicSection.name}`]) selectMusic('default');

    setActiveMusicSection(null);
  };

  return {
    handleFormDataChange,
    handleFormSubmit,
    handlePreviewVideo,
    handleSectionPress,
    handleMusicSelect,
    handleMusicUseDefault,
  };
}

type CompileCtx = {
  project: Project | null;
  template: Template | undefined;
  mediaChoices: MediaChoices;
  qualityTier: QualityTier;
  setProject: (p: Project) => void;
  saveProjectMutation: ReturnType<typeof useSaveProject>;
  onDeviceCompilation: ReturnType<typeof useOnDeviceCompilation>;
  router: ReturnType<typeof useRouter>;
};

function useCompileHandler(ctx: CompileCtx) {
  const { t } = useTranslation('detail');
  const { project, template, mediaChoices, qualityTier, setProject, saveProjectMutation, onDeviceCompilation, router } =
    ctx;

  return () => {
    if (!project || !template) return;

    // The device engine never transcribes: pin the reviewed on-device captions, and stop on a step whose
    // template still asks for a transcription nobody has run yet, or whose clip was retaken since.
    const { descriptor: templateDescriptor, pending } = applyCaptionPins(
      compileTemplate(template.content, project.formData),
      project
    );

    if (pending.length > 0) {
      Alert.alert(
        t('alerts.captionsPending.title'),
        t('alerts.captionsPending.message', { steps: pending.join(', ') })
      );

      return;
    }

    onDeviceCompilation.mutate(
      {
        projectId: project.id,
        templateDescriptor,
        recordedVideos: project.recordedVideos,
        mediaChoices,
        qualityTier,
      },
      {
        onSuccess: (result) => {
          // Check the cancel outcome first: the render can finish successfully inside the abort
          // window, so a cancelled compile must not fall through to the success branch and navigate
          // into a preview the user asked to cancel. The overlay already closed via finish(); leave
          // the user on the hub without the misleading "Compilation Failed" alert.
          if (result.cancelled || result.result.error === 'Compilation cancelled.') {
            return;
          }

          if (result.result.success) {
            const updated = {
              ...project,
              outputVideoUri: result.result.outputUri,
              status: 'completed' as const,
              updatedAt: new Date().toISOString(),
            };
            setProject(updated);
            saveProjectMutation.mutate(updated);
            router.push({
              pathname: '/(fullscreen)/preview',
              params: { projectId: project.id, videoUri: result.result.outputUri },
            });

            return;
          }

          Alert.alert(
            t('alerts.compilationFailed.title'),
            result.result.error ?? t('alerts.compilationFailed.fallback')
          );
        },
        onError: (error: unknown) => {
          console.error('Error during compilation:', error);
          Alert.alert(
            t('alerts.compilationError.title'),
            t('alerts.compilationError.message', {
              error: error instanceof Error ? error.message : t('alerts.compilationError.unknownError'),
            })
          );
        },
      }
    );
  };
}

type ProjectInitArgs = {
  template: Template | undefined;
  existingProject: Project | null | undefined;
  projectLoading: boolean;
  projectId: string | undefined;
  saveProjectMutation: ReturnType<typeof useSaveProject>;
  setProject: (p: Project) => void;
};

function buildDraftProject(template: Template): Project {
  return {
    id: Date.now().toString(),
    name: `${template.name.replace('.json', '')} Project`,
    templateName: template.name,
    templateContent: template.content,
    status: 'draft',
    formData: {},
    recordedVideos: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function useProjectInitialization(args: ProjectInitArgs) {
  const { template, existingProject, projectLoading, projectId, saveProjectMutation, setProject } = args;
  // react-query recreates the mutation object every render and the setProject wrapper is a fresh
  // closure each render, so keep both in refs instead of effect dependencies. Initialize the
  // project exactly once: without the guard, the new-project branch built a fresh object (new
  // Date.now() id) and called setProject every render, causing an infinite update-depth loop and
  // spamming saveProjectMutation.mutate.
  const saveProjectMutationRef = useRef(saveProjectMutation);
  saveProjectMutationRef.current = saveProjectMutation;
  const setProjectRef = useRef(setProject);
  setProjectRef.current = setProject;
  const projectInitializedRef = useRef(false);

  useEffect(() => {
    if (!template || (projectId !== undefined && projectLoading)) return;

    if (projectInitializedRef.current) return;

    if (existingProject) {
      projectInitializedRef.current = true;
      setProjectRef.current(existingProject);

      return;
    }

    if (!projectId) {
      projectInitializedRef.current = true;
      const p = buildDraftProject(template);
      setProjectRef.current(p);
      saveProjectMutationRef.current.mutate(p);
    }
  }, [template, existingProject, projectLoading, projectId]);
}

/** Owns the user's media-step state (music/background choices + picker visibility). */
function useMediaState(template: Template | undefined) {
  const [mediaPickerVisible, setMediaPickerVisible] = useState(false);
  const [musicChoice, setMusicChoice] = useState<MediaChoice | null>(null);
  const [backgroundChoice, setBackgroundChoice] = useState<MediaChoice | null>(null);
  const defaultApplied = useRef(false);

  // Pre-select the template's default soundtrack the first time it loads. Applied once, so a later user
  // change (picking another track or clearing it) is never overwritten.
  useEffect(() => {
    if (defaultApplied.current || !template) return;

    defaultApplied.current = true;

    const choice = defaultMusicChoice(template);

    if (choice) setMusicChoice(choice);
  }, [template]);

  const mediaChoices: MediaChoices = {
    music: musicChoice ?? undefined,
    background: backgroundChoice ?? undefined,
  };
  // Media step is "done" once any choice is made (music or background). If neither is
  // required the row never appears, so we don't gate compile on it.
  const mediaStepDone = Boolean(musicChoice ?? backgroundChoice);

  return {
    mediaPickerVisible,
    setMediaPickerVisible,
    musicChoice,
    setMusicChoice,
    backgroundChoice,
    setBackgroundChoice,
    mediaChoices,
    mediaStepDone,
  };
}

function useTemplateHandlers(
  ctx: HandlerCtx & Pick<CompileCtx, 'mediaChoices' | 'qualityTier' | 'onDeviceCompilation'>
) {
  const sectionHandlers = useSectionHandlers(ctx);
  const handleCompile = useCompileHandler({
    project: ctx.project,
    template: ctx.template,
    mediaChoices: ctx.mediaChoices,
    qualityTier: ctx.qualityTier,
    setProject: ctx.setProject,
    saveProjectMutation: ctx.saveProjectMutation,
    onDeviceCompilation: ctx.onDeviceCompilation,
    router: ctx.router,
  });

  return { ...sectionHandlers, handleCompile };
}

export function useTemplateDetail(templateName: string, projectId: string | undefined) {
  const { t } = useTranslation('detail');
  const router = useRouter();
  const { data: template, isLoading: templateLoading, error: templateError } = useTemplate(templateName);
  const { data: existingProject, isLoading: projectLoading } = useProject(projectId ?? '');
  const saveProjectMutation = useSaveProject();
  const onDeviceCompilation = useOnDeviceCompilation();
  // The app is fully local — compilation always renders on-device now, never queued.
  const [project, setProject] = useState<Project | null>(null);
  const [activeFormSection, setActiveFormSection] = useState<Section | null>(null);
  const [activeMusicSection, setActiveMusicSection] = useState<Section | null>(null);
  // Render-quality choice for this session — component state (not persisted with the project), so it
  // resets to the standard default whenever the screen is freshly opened.
  const [qualityTier, setQualityTier] = useState<QualityTier>('standard');
  const {
    mediaPickerVisible,
    setMediaPickerVisible,
    musicChoice,
    setMusicChoice,
    backgroundChoice,
    setBackgroundChoice,
    mediaChoices,
    mediaStepDone,
  } = useMediaState(template);

  useProjectInitialization({
    template,
    existingProject,
    projectLoading,
    projectId,
    saveProjectMutation,
    setProject,
  });
  // A projectId was passed but its query finished with no such project — a genuine not-found (e.g. a
  // deleted/stale link). Distinct from `project` simply not being initialized yet (no projectId →
  // a draft is always created), which must read as "loading", not "not found".
  const projectMissing = projectId !== undefined && !projectLoading && !existingProject;
  const { filtered: filteredSections, completed: completedSectionsCount } = getSectionInfo(template, project);
  const hasMediaStep = needsMediaStep(template?.content.global);
  const hCtx: HandlerCtx = {
    project,
    template,
    activeFormSection,
    activeMusicSection,
    setProject,
    setActiveFormSection,
    setActiveMusicSection,
    saveProjectMutation,
    router,
  };
  const {
    handleFormDataChange,
    handleFormSubmit,
    handlePreviewVideo,
    handleSectionPress,
    handleMusicSelect,
    handleMusicUseDefault,
    handleCompile,
  } = useTemplateHandlers({ ...hCtx, mediaChoices, qualityTier, onDeviceCompilation });
  const allDone = computeAllDone(project, template, filteredSections, hasMediaStep, mediaStepDone);

  const description = buildHeaderDescription(template, project, t);

  return {
    template,
    templateLoading,
    templateError,
    projectMissing,
    project,
    filteredSections,
    completedSectionsCount,
    allDone,
    orientation: template?.content.global?.orientation ?? 'portrait',
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
    isPending: onDeviceCompilation.isPending,
    willQueue: false,
    handleFormDataChange,
    handleFormSubmit,
    handlePreviewVideo,
    handleSectionPress,
    handleMusicSelect,
    handleMusicUseDefault,
    handleCompile,
    router,
  };
}
