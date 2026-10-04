// The Info and Scenes wizard-step views, split out of the create-template screen to keep it small.
// They take typed callbacks and never mutate EditorState — the screen applies edits through the
// shared pure ops. The Style & Audio step lives in StyleAudioStep.tsx.
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, withAlpha } from '@/src/styles/theme';
import { SceneCard } from './SceneCard';
import { ORIENTATION_ICON, ORIENTATION_ORDER } from '../orientationMeta';
// Re-exported so the create-template screen imports all scene-step views from one module (keeps its
// dependency count in check).
export { SceneTimeline } from './SceneTimeline';
import { lastVisualIndex } from './wizardSteps';
import {
  defaultCountdownFor,
  SECTION_LABELS,
  SECTION_KINDS,
  type EditorSection,
  type EditorState,
  type BackgroundLayer,
} from '../model/templateEditorModel';

type VideoSection = Extract<EditorSection, { kind: 'video' }>;

const KIND_ICON: Record<EditorSection['kind'], keyof typeof Ionicons.glyphMap> = {
  video: 'videocam',
  form: 'text',
  color: 'color-palette',
  music: 'musical-notes',
  image: 'image-outline',
  partial: 'cube-outline',
};

interface InfoStepProps {
  state: EditorState;
  t: TFunction<'editor'>;
  onPatch: (p: Partial<EditorState>) => void;
}

export const InfoStep = ({ state, t, onPatch }: InfoStepProps) => (
  <View>
    <Text style={styles.label}>{t('name.label')}</Text>
    <TextInput
      testID="tpl-name"
      style={styles.input}
      value={state.name}
      onChangeText={(name) => {
        onPatch({ name });
      }}
      placeholder={t('name.placeholder')}
      placeholderTextColor={colors.textSecondary}
    />

    <Text style={[styles.label, { marginTop: spacing.l }]}>{t('description.label')}</Text>
    <TextInput
      testID="tpl-description"
      style={[styles.input, styles.inputMultiline]}
      value={state.description}
      onChangeText={(description) => {
        onPatch({ description });
      }}
      placeholder={t('description.placeholder')}
      placeholderTextColor={colors.textSecondary}
      multiline
    />

    <Text style={[styles.label, { marginTop: spacing.l }]}>{t('orientation.label')}</Text>
    <View style={styles.segment}>
      {ORIENTATION_ORDER.map((o) => {
        const active = state.orientation === o;

        return (
          <TouchableOpacity
            key={o}
            testID={`orient-${o}`}
            onPress={() => {
              onPatch({ orientation: o });
            }}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <Ionicons name={ORIENTATION_ICON[o]} size={16} color={active ? '#fff' : colors.textSecondary} />
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{t(`orientation.${o}`)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>

    <VariablesEditor state={state} t={t} onPatch={onPatch} />
  </View>
);

// Reusable {{ name }} → value pairs, inserted into any text field via the variable menu. Mirrors the
// web GlobalVariablesEditor; edits flow through onPatch so each change is one undoable step.
const VariablesEditor = ({ state, t, onPatch }: InfoStepProps) => {
  const { globalVariables } = state;

  const update = (i: number, p: Partial<EditorState['globalVariables'][number]>) => {
    onPatch({ globalVariables: globalVariables.map((v, idx) => (idx === i ? { ...v, ...p } : v)) });
  };

  return (
    <View style={{ marginTop: spacing.l }}>
      <Text style={styles.label}>{t('variables.label')}</Text>
      <Text style={styles.hint}>{t('variables.hint')}</Text>
      {globalVariables.map((variable, i) => (
        <View key={i} style={styles.varRow}>
          <TextInput
            style={[styles.input, styles.varInput]}
            value={variable.name}
            onChangeText={(name) => {
              update(i, { name });
            }}
            autoCapitalize="none"
            placeholder={t('variables.name')}
            placeholderTextColor={colors.textSecondary}
          />
          <TextInput
            style={[styles.input, styles.varInput]}
            value={variable.value}
            onChangeText={(value) => {
              update(i, { value });
            }}
            placeholder={t('variables.value')}
            placeholderTextColor={colors.textSecondary}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('variables.remove', { n: i + 1 })}
            onPress={() => {
              onPatch({ globalVariables: globalVariables.filter((_, idx) => idx !== i) });
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity
        onPress={() => {
          onPatch({ globalVariables: [...globalVariables, { name: '', value: '' }] });
        }}
        style={styles.addInline}
      >
        <Ionicons name="add" size={14} color={colors.primary} />
        <Text style={styles.addInlineText}>{t('variables.add')}</Text>
      </TouchableOpacity>
    </View>
  );
};

interface ScenesStepProps {
  state: EditorState;
  t: TFunction<'editor'>;
  onPatchSection: (i: number, p: Partial<EditorSection>) => void;
  onLayers: (i: number, layers: BackgroundLayer[]) => void;
  onRemove: (i: number) => void;
  onDuplicate: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onAdd: (kind: EditorSection['kind']) => void;
  onOpenTransition: (i: number) => void;
  onEditOverlay: (sectionIndex: number, overlayIndex: number) => void;
  // Reports each scene card's y within this block so the timeline strip can scroll it into view.
  onSectionLayout?: (i: number, y: number) => void;
}

export const ScenesStep = (props: ScenesStepProps) => {
  const { state, t, onPatchSection, onLayers, onRemove, onDuplicate, onMove, onAdd, onOpenTransition, onEditOverlay } =
    props;
  const lastVisual = lastVisualIndex(state);
  // In-scope variable names insertable as `{{ name }}` tokens into titleCard/lowerThird text lines
  // (same set OverlayPositioner offers for text overlays).
  const variables = state.globalVariables.map((v) => v.name).filter((name) => name.trim() !== '');

  return (
    <View>
      {state.sections.map((section, i) => (
        <View
          key={i}
          onLayout={(e) => {
            props.onSectionLayout?.(i, e.nativeEvent.layout.y);
          }}
        >
          <SceneCard
            orientation={state.orientation}
            index={i}
            count={state.sections.length}
            section={section}
            t={t}
            variables={variables}
            defaultCountdownSeconds={defaultCountdownFor}
            onChange={(p) => {
              onPatchSection(i, p);
            }}
            onLayers={(layers) => {
              onLayers(i, layers);
            }}
            onRemove={() => {
              onRemove(i);
            }}
            onDuplicate={() => {
              onDuplicate(i);
            }}
            onMove={(dir) => {
              onMove(i, dir);
            }}
            onEditOverlay={(overlayIndex) => {
              onEditOverlay(i, overlayIndex);
            }}
          />
          {section.kind !== 'music' && i !== lastVisual ? (
            <TransitionConnector
              section={section}
              t={t}
              onPress={() => {
                onOpenTransition(i);
              }}
            />
          ) : null}
        </View>
      ))}

      <Text style={[styles.label, { marginTop: spacing.l }]}>{t('scenes.add')}</Text>
      <View style={styles.addRow}>
        {SECTION_KINDS.map((kind) => (
          <TouchableOpacity
            key={kind}
            testID={`add-${kind}`}
            onPress={() => {
              onAdd(kind);
            }}
            style={styles.addBtn}
          >
            <Ionicons name={KIND_ICON[kind]} size={16} color={colors.primary} />
            <Text style={styles.addBtnText}>{SECTION_LABELS[kind]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

interface TransitionConnectorProps {
  section: EditorSection;
  t: TFunction<'editor'>;
  onPress: () => void;
}

// The tappable boundary between two scenes; shows the current transition (or "Cut").
const TransitionConnector = ({ section, t, onPress }: TransitionConnectorProps) => {
  const transition = section.kind === 'music' ? undefined : (section as VideoSection).transitionAfter;
  const label = transition ? `${transition.type} · ${transition.duration ?? 0.5}s` : t('transition.cut');

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${t('transition.title')}: ${label}`}
      testID="open-transition"
      onPress={onPress}
      style={styles.connector}
    >
      <View style={styles.connectorLine} />
      <View style={styles.connectorChip}>
        <Ionicons name="swap-vertical" size={13} color={colors.primary} />
        <Text style={styles.connectorText}>{label}</Text>
      </View>
      <View style={styles.connectorLine} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  label: {
    ...typography.smallText,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  hint: { ...typography.smallText, color: colors.textSecondary, marginBottom: spacing.s },
  varRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginBottom: spacing.s },
  varInput: { flex: 1 },
  addInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: spacing.m,
    borderRadius: 999,
    backgroundColor: withAlpha(colors.primary, 0.08),
  },
  addInlineText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  segment: { flexDirection: 'row', gap: spacing.s },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  segmentItemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { ...typography.caption, color: colors.textSecondary },
  segmentTextActive: { color: '#fff' },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, marginTop: spacing.s },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: spacing.m,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: withAlpha(colors.primary, 0.08),
  },
  addBtnText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  connector: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingVertical: spacing.xs },
  connectorLine: { flex: 1, height: 1, backgroundColor: colors.divider },
  connectorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: spacing.m,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  connectorText: { ...typography.smallText, color: colors.text, textTransform: 'capitalize' },
});
