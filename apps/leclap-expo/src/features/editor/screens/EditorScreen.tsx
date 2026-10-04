import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import FormSection from '../components/FormSection';
import type { Template, Section, Project } from '@/src/types';
import { colors, spacing, typography } from '@/src/styles/theme';
import { findInCatalog } from '@/src/templates/catalog';
import { useUserTemplateStore } from '@/src/stores/useUserTemplateStore';
import { compileOnDevice } from '@/src/services/compile/compileOnDevice';
import { compileTemplate } from '@/src/features/templates/detail/compile-template';
import { useProjectStore } from '@/src/stores/useProjectStore';
import { useRouter } from 'expo-router';
import { ExportSheet } from '../components/ExportSheet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EditorRoute {
  params: { templateName: string; projectId?: string };
}
interface EditorNavigation {
  goBack: () => void;
}
interface Props {
  route: EditorRoute;
  navigation: EditorNavigation;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function buildNewProject(t: Template): Project {
  return {
    id: Date.now().toString(),
    name: `${t.name.replace('.json', '')} Project`,
    templateName: t.name,
    templateContent: t.content,
    status: 'draft',
    formData: {},
    recordedVideos: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function checkSectionDone(section: Section, project: Project): boolean {
  if (section.type === 'project_video' || section.type === 'picture') {
    return Boolean(project.recordedVideos[section.name]);
  }

  if (section.type === 'form') {
    return (section.options?.fields ?? []).every((f) => Boolean(project.formData[f.name]));
  }

  if (section.type === 'music') return Boolean(project.formData[`music_${section.name}`]);

  return false;
}

function getSectionIcon(type: string): React.ComponentProps<typeof Ionicons>['name'] {
  if (type === 'project_video') return 'videocam';

  if (type === 'form') return 'document-text';

  if (type === 'music') return 'musical-notes';

  if (type === 'picture') return 'image';

  return 'document';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const LoadingView: React.FC = () => (
  <View style={st.loading}>
    <ActivityIndicator size="large" color={colors.primary} />
    <Text style={st.loadingText}>Loading editor...</Text>
  </View>
);

interface FullscreenWrapProps {
  section: Section;
  onBack: () => void;
  children: React.ReactNode;
}
const FullscreenWrap: React.FC<FullscreenWrapProps> = ({ section, onBack, children }) => (
  <SafeAreaView style={st.fullscreen}>
    <View style={{ flex: 1 }}>
      <StatusBar hidden={false} backgroundColor="transparent" translucent />
      <TouchableOpacity style={st.fsBack} onPress={onBack}>
        <Ionicons name="arrow-back" size={24} color="white" />
      </TouchableOpacity>
      <View style={st.fsTitleBox}>
        <Text style={st.fsTitle}>{section.title?.en ?? section.name}</Text>
      </View>
      {children}
    </View>
  </SafeAreaView>
);

interface SectionRowProps {
  section: Section;
  done: boolean;
  onPress: () => void;
}
const SectionRow: React.FC<SectionRowProps> = ({ section, done, onPress }) => (
  <TouchableOpacity style={st.row} onPress={onPress}>
    <View style={st.rowContent}>
      <View style={st.rowIcon}>
        <Ionicons name={getSectionIcon(section.type)} size={24} color={colors.primary} />
      </View>
      <View style={st.rowText}>
        <Text style={st.rowTitle}>{section.title?.en ?? section.name}</Text>
        {section.description?.en ? (
          <Text style={st.rowDesc} numberOfLines={1}>
            {section.description.en}
          </Text>
        ) : null}
      </View>
      <View style={st.rowStatus}>
        {done ? (
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
        ) : (
          <Ionicons name="ellipse-outline" size={24} color={colors.divider} />
        )}
      </View>
    </View>
  </TouchableOpacity>
);

interface SectionContentProps {
  section: Section;
  project: Project;
  template: Template;
  onFormChange: (field: string, value: string) => void;
  onProjectUpdate: (project: Project) => void;
  onDone: () => void;
}

const SectionContent: React.FC<SectionContentProps> = ({
  section,
  project,
  template,
  onFormChange,
  onProjectUpdate,
  onDone,
}) => {
  const router = useRouter();

  if (section.type === 'project_video' || section.type === 'picture') {
    return (
      <TouchableOpacity
        style={st.recordBtn}
        onPress={() => {
          router.push({
            pathname: '/(fullscreen)/record-section',
            params: {
              orientation: template.content.global?.orientation ?? 'portrait',
              sectionName: section.name,
              sectionType: section.type,
            },
          });
        }}
      >
        <Ionicons name="videocam" size={32} color={colors.surface} />
        <Text style={st.recordBtnText}>Start Recording</Text>
      </TouchableOpacity>
    );
  }

  if (section.type === 'form') {
    return (
      <View style={st.formBox}>
        <FormSection
          section={section}
          formData={project.formData as Record<string, string>}
          onFormDataChange={onFormChange}
        />
      </View>
    );
  }

  if (section.type === 'music') {
    return (
      <View style={st.placeholder}>
        <Ionicons name="musical-notes" size={48} color={colors.primary} />
        <Text style={st.placeholderText}>Music selection coming soon</Text>
        <TouchableOpacity
          style={st.tempBtn}
          onPress={() => {
            onProjectUpdate({
              ...project,
              formData: { ...project.formData, [`music_${section.name}`]: 'default' },
              updatedAt: new Date().toISOString(),
            });
            onDone();
          }}
        >
          <Text style={st.tempBtnText}>Use Default Music</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={st.placeholder}>
      <Text style={st.placeholderText}>This section type is not supported yet</Text>
      <TouchableOpacity style={st.backBtn} onPress={onDone}>
        <Text style={st.backBtnText}>Back to Sections</Text>
      </TouchableOpacity>
    </View>
  );
};

// ─── Footer ───────────────────────────────────────────────────────────────────

interface EditorFooterProps {
  allDone: boolean;
  isCompiling: boolean;
  outputVideoUri: string | undefined;
  showExportSheet: boolean;
  onCompile: () => void;
  onCloseExport: () => void;
}

const EditorFooter = ({
  allDone,
  isCompiling,
  outputVideoUri,
  showExportSheet,
  onCompile,
  onCloseExport,
}: EditorFooterProps) => (
  <>
    <View style={st.footer}>
      <TouchableOpacity
        style={[st.compileBtn, (!allDone || isCompiling) && st.disabledBtn]}
        disabled={!allDone || isCompiling}
        onPress={onCompile}
      >
        <Text style={st.compileBtnText}>{isCompiling ? 'Creating Video...' : 'Create My Video'}</Text>
        {isCompiling ? <ActivityIndicator size="small" color="white" style={st.loader} /> : null}
      </TouchableOpacity>
    </View>
    {outputVideoUri ? (
      <ExportSheet visible={showExportSheet} videoUri={outputVideoUri} onClose={onCloseExport} />
    ) : null}
  </>
);

// ─── Main component ───────────────────────────────────────────────────────────

export const EditorScreen: React.FC<Props> = ({ route, navigation }) => {
  const { templateName, projectId } = route.params;
  const [template, setTemplate] = useState<Template | null>(null);
  const [activeSection, setActiveSection] = useState<Section | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompiling, setIsCompiling] = useState(false);
  const [showExportSheet, setShowExportSheet] = useState(false);
  const currentProject = useProjectStore((state) => state.currentProject);
  const projects = useProjectStore((state) => state.projects);
  const addProject = useProjectStore((state) => state.addProject);
  const updateProject = useProjectStore((state) => state.updateProject);
  const setCurrentProject = useProjectStore((state) => state.setCurrentProject);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);

      try {
        const templateData = findInCatalog(useUserTemplateStore.getState().templates, templateName);

        if (!templateData) {
          throw new Error(`Template "${templateName}" not found in the local catalog`);
        }

        setTemplate(templateData);

        const existing = projectId ? projects.find((p) => p.id === projectId) : undefined;

        if (existing) {
          setCurrentProject(existing);

          return;
        }

        const newProject = buildNewProject(templateData);
        addProject(newProject);
        setCurrentProject(newProject);
      } catch (error) {
        console.error('Failed to load data:', error);
        Alert.alert('Error', 'Failed to load template data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };
    load().catch(console.error);
  }, [templateName, projectId, projects, addProject, setCurrentProject]);

  const handleFormDataChange = (field: string, value: string) => {
    if (!currentProject) return;
    updateProject({
      ...currentProject,
      formData: { ...currentProject.formData, [field]: value },
      updatedAt: new Date().toISOString(),
    });
  };

  const handleCompileVideo = () => {
    if (!currentProject || !template) return;
    setIsCompiling(true);
    const doCompile = async () => {
      const result = await compileOnDevice(
        compileTemplate(template.content, currentProject.formData),
        currentProject.recordedVideos
      );

      if (result.success) {
        updateProject({
          ...currentProject,
          outputVideoUri: result.outputUri,
          status: 'completed' as const,
          updatedAt: new Date().toISOString(),
        });
        setShowExportSheet(true);

        return;
      }
      Alert.alert('Compilation Failed', result.error ?? 'An error occurred during video compilation.');
    };
    doCompile()
      .catch((error: unknown) => {
        console.error('Error during compilation:', error);
        Alert.alert('Compilation Error', 'An unexpected error occurred. Please try again.');
      })
      .finally(() => {
        setIsCompiling(false);
      });
  };

  if (isLoading || !template || !currentProject) return <LoadingView />;

  const sections = (template.content.sections ?? []).filter((sec) =>
    ['project_video', 'form', 'music', 'picture'].includes(sec.type)
  );
  const allDone = sections.length > 0 && sections.every((sec) => checkSectionDone(sec, currentProject));

  if (activeSection) {
    return (
      <FullscreenWrap
        section={activeSection}
        onBack={() => {
          setActiveSection(null);
        }}
      >
        <SectionContent
          section={activeSection}
          project={currentProject}
          template={template}
          onFormChange={handleFormDataChange}
          onProjectUpdate={updateProject}
          onDone={() => {
            setActiveSection(null);
          }}
        />
      </FullscreenWrap>
    );
  }

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity
          style={st.backBtn}
          onPress={() => {
            navigation.goBack();
          }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={st.title}>{template.name.replace('.json', '')}</Text>
      </View>
      <ScrollView style={st.content}>
        <View style={st.listContainer}>
          <Text style={st.listTitle}>Sections</Text>
          <Text style={st.listDesc}>Tap on a section to edit</Text>
          {sections.map((section) => (
            <SectionRow
              key={section.name}
              section={section}
              done={checkSectionDone(section, currentProject)}
              onPress={() => {
                setActiveSection(section);
              }}
            />
          ))}
        </View>
      </ScrollView>
      <EditorFooter
        allDone={allDone}
        isCompiling={isCompiling}
        outputVideoUri={currentProject.outputVideoUri}
        showExportSheet={showExportSheet}
        onCompile={handleCompileVideo}
        onCloseExport={() => {
          setShowExportSheet(false);
        }}
      />
    </SafeAreaView>
  );
};

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  loadingText: { ...typography.body, marginTop: spacing.m },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: { padding: spacing.s },
  title: { ...typography.title, flex: 1, marginLeft: spacing.m },
  content: { flex: 1 },
  listContainer: { padding: spacing.m },
  listTitle: { ...typography.title, marginBottom: spacing.s },
  listDesc: { ...typography.caption, marginBottom: spacing.m },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginBottom: spacing.m,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  rowContent: { flexDirection: 'row', alignItems: 'center', padding: spacing.m },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary + '10',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.m,
  },
  rowText: { flex: 1 },
  rowTitle: { ...typography.subtitle, marginBottom: spacing.xs },
  rowDesc: { ...typography.caption },
  rowStatus: { marginLeft: spacing.m },
  footer: { padding: spacing.m, borderTopWidth: 1, borderTopColor: colors.divider },
  compileBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
    padding: spacing.m,
    borderRadius: 8,
  },
  disabledBtn: { opacity: 0.5 },
  compileBtnText: { color: colors.surface, fontWeight: 'bold', fontSize: 16 },
  loader: { marginLeft: spacing.m },
  fullscreen: {
    flex: 1,
    backgroundColor: '#000',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9000,
  },
  fsBack: {
    position: 'absolute',
    top: 15,
    left: 15,
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: spacing.s,
  },
  fsTitleBox: {
    position: 'absolute',
    top: 15,
    left: 60,
    right: 15,
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: spacing.s,
    paddingHorizontal: spacing.m,
  },
  fsTitle: { color: 'white', fontSize: 18, fontWeight: '600' },
  formBox: { flex: 1, backgroundColor: colors.background },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.l,
    backgroundColor: colors.background,
  },
  placeholderText: { ...typography.body, marginVertical: spacing.m, textAlign: 'center' },
  tempBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    borderRadius: 8,
    marginTop: spacing.l,
  },
  tempBtnText: { color: colors.surface, fontWeight: 'bold' },
  backBtnText: { ...typography.body, color: colors.primary, marginTop: spacing.m },
  recordBtn: {
    backgroundColor: colors.primary,
    padding: spacing.l,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.xl,
  },
  recordBtnText: { ...typography.subtitle, color: colors.surface, marginLeft: spacing.m, fontWeight: 'bold' },
});

export default EditorScreen;
