import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as Haptics from 'expo-haptics';
import Button from '@/src/components/ui/Button';
import { colors, spacing, typography, FORM_MAX_WIDTH } from '@/src/styles/theme';
import { useUserTemplateStore, type UserTemplate } from '@/src/stores/useUserTemplateStore';
import { TransitionSheet } from '@/src/features/templates/components/TransitionSheet';
import { OverlayPositioner } from '@/src/features/templates/components/OverlayPositioner';
import { StyleAudioStep } from '@/src/features/templates/components/StyleAudioStep';
import { InfoStep, ScenesStep, SceneTimeline } from '@/src/features/templates/components/WizardStepViews';
import { useEditorHistory } from '@/src/features/templates/components/useEditorHistory';
import { exportTemplate, importTemplate, previewRender } from '@/src/features/templates/components/editorIO';
import sampleClip from '../../assets/sample.mp4';
import { STEP_TITLE_KEY, saveBlocker } from '@/src/features/templates/components/wizardSteps';
import {
  buildDescriptor,
  newSection,
  newOverlay,
  toEditorState,
  reorderSection,
  duplicateSection,
  setTransitionAfter,
  patchLayers,
  type EditorSection,
  type EditorState,
  type EditableTemplate,
  type TextOverlay,
} from '@/src/features/templates/model/templateEditorModel';
import type { TemplateDescriptor } from '@/src/types';

// The on-device store keeps templates under the app-local descriptor type, while the shared editor
// model speaks the core descriptor type. They are structurally identical for what the editor
// reads/writes; this adapter bridges a stored UserTemplate into the shared EditableTemplate shape.
const toEditable = (template: UserTemplate | undefined): EditableTemplate | null =>
  template ? { ...template, descriptor: template.descriptor as EditableTemplate['descriptor'] } : null;

type VideoSection = Extract<EditorSection, { kind: 'video' }>;

// Export shares the descriptor JSON; import picks a .json, validates it, and replaces the state
// (a single history entry). Cancel is a no-op; a bad file alerts. Lifted out so the wizard hook
// stays under its statement budget.
function makeTemplateIO(state: EditorState, setState: (s: EditorState) => void, t: TFunction<'editor'>) {
  return {
    onExport: () => {
      exportTemplate(state).catch(() => {});
    },
    onImport: () => {
      importTemplate(state)
        .then((next) => {
          if (!next) return;

          setState(next);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        })
        .catch(() => {
          Alert.alert(t('importError.title'), t('importError.description'));
        });
    },
  };
}

// All wizard state + the pure-op mutators, lifted out of the screen so the component stays small.
// Every section edit flows through the shared pure ops — never mutating EditorState in place.
function useTemplateWizard(t: TFunction<'editor'>) {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const getById = useUserTemplateStore((s) => s.getById);
  const save = useUserTemplateStore((s) => s.save);

  const { state, setState, undo, redo, canUndo, canRedo } = useEditorHistory(() =>
    toEditorState(toEditable(id ? getById(id) : undefined))
  );
  const [transitionIndex, setTransitionIndex] = useState<number | null>(null);
  const [overlayIndex, setOverlayIndex] = useState<number | null>(null);
  // Which text overlay within the section's overlays[] is open in the positioner (a section can carry
  // several). Editing at length appends a fresh overlay first, so the "Add text" affordance reuses this.
  const [overlayLayer, setOverlayLayer] = useState(0);

  const patch = (p: Partial<EditorState>) => {
    setState((s) => ({ ...s, ...p }));
  };

  const patchSection = (i: number, p: Partial<EditorSection>) => {
    setState((s) => ({
      ...s,
      sections: s.sections.map((sec, idx) => (idx === i ? ({ ...sec, ...p } as EditorSection) : sec)),
    }));
  };

  const onSave = () => {
    const blocker = saveBlocker(state);

    if (blocker) {
      Alert.alert(t('alerts.almostThere'), t(blocker.messageKey));

      return;
    }

    save({
      id: state.id,
      name: state.name.trim(),
      description: state.description.trim(),
      orientation: state.orientation,
      descriptor: buildDescriptor(state) as TemplateDescriptor,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.back();
  };

  const close = () => {
    router.back();
  };

  const openOverlay = (i: number, layer: number) => {
    const target = state.sections[i];

    if (target.kind !== 'video') return;

    // Editing past the end (the "Add text" affordance) appends a fresh overlay to edit.
    if (layer >= target.overlays.length) patchSection(i, { overlays: [...target.overlays, newOverlay()] });

    setOverlayIndex(i);
    setOverlayLayer(layer);
  };

  const transitionSection = transitionIndex === null ? undefined : state.sections[transitionIndex];
  const transitionValue =
    transitionSection && transitionSection.kind !== 'music'
      ? (transitionSection as VideoSection).transitionAfter
      : undefined;
  const overlaySection = overlayIndex === null ? undefined : state.sections[overlayIndex];
  const overlay: TextOverlay | undefined =
    overlaySection?.kind === 'video' ? overlaySection.overlays[overlayLayer] : undefined;

  const io = makeTemplateIO(state, setState, t);

  return {
    state,
    setState,
    patch,
    patchSection,
    transitionIndex,
    setTransitionIndex,
    transitionValue,
    overlaySection,
    overlayIndex,
    setOverlayIndex,
    overlayLayer,
    overlay,
    onSave,
    close,
    openOverlay,
    undo,
    redo,
    canUndo,
    canRedo,
    ...io,
  };
}

export default function CreateTemplateScreen() {
  const { t } = useTranslation('editor');
  const router = useRouter();
  const [rendering, setRendering] = useState(false);
  const {
    state,
    setState,
    patch,
    patchSection,
    transitionIndex,
    setTransitionIndex,
    transitionValue,
    overlaySection,
    overlayIndex,
    setOverlayIndex,
    overlayLayer,
    overlay,
    onSave,
    close,
    openOverlay,
    undo,
    redo,
    canUndo,
    canRedo,
    onImport,
    onExport,
  } = useTemplateWizard(t);

  // Timeline → scroll a scene card into view. Each card reports its y within the Scenes block; the block
  // reports its own offset in the scroll content, so absolute target = block offset + card y.
  const scrollRef = useRef<ScrollView>(null);
  const scenesRootY = useRef(0);
  const sectionYs = useRef<number[]>([]);
  const scrollToSection = (i: number) => {
    scrollRef.current?.scrollTo({ y: scenesRootY.current + (sectionYs.current[i] ?? 0), animated: true });
  };

  // Compile the draft on-device with placeholder clips, then open the shared preview screen — the
  // Expo twin of the web "Test render". The button's own spinner covers the wait.
  const onPreview = () => {
    if (rendering) return;

    setRendering(true);
    previewRender(state, sampleClip)
      .then((result) => {
        if (result.success && result.outputUri) {
          router.push({
            pathname: '/(fullscreen)/preview',
            params: { videoUri: result.outputUri, orientation: state.orientation },
          });

          return;
        }

        Alert.alert(t('previewError.title'), result.error ?? t('previewError.description'));
      })
      .catch(() => {
        Alert.alert(t('previewError.title'), t('previewError.description'));
      })
      .finally(() => {
        setRendering(false);
      });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1, width: '100%', maxWidth: FORM_MAX_WIDTH, alignSelf: 'center' }}>
        <View style={styles.header}>
          <TouchableOpacity
            testID="close-editor"
            onPress={close}
            style={styles.iconBtn}
            accessibilityLabel={t('header.back')}
          >
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerSpacer} />
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={undo}
              disabled={!canUndo}
              accessibilityLabel={t('header.undo')}
              style={styles.actionBtn}
            >
              <Ionicons name="arrow-undo" size={20} color={canUndo ? colors.text : colors.divider} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={redo}
              disabled={!canRedo}
              accessibilityLabel={t('header.redo')}
              style={styles.actionBtn}
            >
              <Ionicons name="arrow-redo" size={20} color={canRedo ? colors.text : colors.divider} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onImport} accessibilityLabel={t('header.import')} style={styles.actionBtn}>
              <Ionicons name="download-outline" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onExport} accessibilityLabel={t('header.export')} style={styles.actionBtn}>
              <Ionicons name="share-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={styles.sectionHeading}>{t(STEP_TITLE_KEY.info)}</Text>
          <InfoStep state={state} t={t} onPatch={patch} />

          <Text style={styles.sectionHeading}>{t(STEP_TITLE_KEY.scenes)}</Text>
          <SceneTimeline state={state} t={t} onSelect={scrollToSection} />
          <View
            onLayout={(e) => {
              scenesRootY.current = e.nativeEvent.layout.y;
            }}
          >
            <ScenesStep
              state={state}
              t={t}
              onSectionLayout={(i, y) => {
                sectionYs.current[i] = y;
              }}
              onPatchSection={patchSection}
              onLayers={(i, layers) => {
                setState((s) => patchLayers(s, i, layers));
              }}
              onRemove={(i) => {
                setState((s) => ({ ...s, sections: s.sections.filter((_, idx) => idx !== i) }));
              }}
              onDuplicate={(i) => {
                setState((s) => duplicateSection(s, i));
                Haptics.selectionAsync().catch(() => {});
              }}
              onMove={(i, dir) => {
                setState((s) => reorderSection(s, i, i + dir));
                Haptics.selectionAsync().catch(() => {});
              }}
              onAdd={(kind) => {
                setState((s) => ({ ...s, sections: [...s.sections, newSection(kind)] }));
                Haptics.selectionAsync().catch(() => {});
              }}
              onOpenTransition={setTransitionIndex}
              onEditOverlay={openOverlay}
            />
          </View>

          <Text style={styles.sectionHeading}>{t(STEP_TITLE_KEY.style)}</Text>
          <StyleAudioStep state={state} t={t} onPatch={patch} />

          <View style={{ height: spacing.xl }} />
        </ScrollView>

        <View style={styles.footer} testID="save-template">
          <View style={styles.footerRow}>
            <View style={styles.footerCol}>
              <Button
                variant="secondary"
                size="large"
                icon="play"
                fullWidth
                loading={rendering}
                disabled={rendering}
                onPress={onPreview}
              >
                {t('preview')}
              </Button>
            </View>
            <View style={styles.footerCol}>
              <Button variant="primary" size="large" icon="save" fullWidth disabled={rendering} onPress={onSave}>
                {t('save')}
              </Button>
            </View>
          </View>
        </View>

        <TransitionSheet
          visible={transitionIndex !== null}
          t={t}
          transition={transitionValue}
          onClose={() => {
            setTransitionIndex(null);
          }}
          onChange={(transition) => {
            if (transitionIndex !== null) setState((s) => setTransitionAfter(s, transitionIndex, transition));
          }}
        />

        <OverlayPositioner
          visible={overlayIndex !== null && overlay !== undefined}
          overlay={overlay}
          orientation={state.orientation}
          variables={state.globalVariables.map((v) => v.name).filter((name) => name.trim() !== '')}
          t={t}
          onClose={() => {
            setOverlayIndex(null);
          }}
          onChange={(next) => {
            if (overlayIndex === null || !overlaySection || overlaySection.kind !== 'video') return;

            patchSection(overlayIndex, {
              overlays: overlaySection.overlays.map((o, idx) => (idx === overlayLayer ? next : o)),
            });
          }}
          onRemove={() => {
            if (overlayIndex === null || !overlaySection || overlaySection.kind !== 'video') return;

            patchSection(overlayIndex, { overlays: overlaySection.overlays.filter((_, idx) => idx !== overlayLayer) });
            setOverlayIndex(null);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.m,
    paddingTop: spacing.s,
    paddingBottom: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerSpacer: { flex: 1 },
  iconBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.m },
  sectionHeading: { ...typography.title, color: colors.text, marginTop: spacing.l, marginBottom: spacing.s },
  footer: {
    padding: spacing.m,
    paddingBottom: spacing.l,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  footerRow: { flexDirection: 'row', gap: spacing.s },
  footerCol: { flex: 1 },
});
