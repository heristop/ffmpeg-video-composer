// The Style & Audio wizard step: a default cross-scene transition picker plus the global audio mix
// (source volume, music volume, loudness normalize, ducking). Writes state.defaultTransition and
// state.audio through onPatch. Enums imported from the core, never hardcoded.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/src/styles/theme';
import { Slider, Segmented } from './EditorControls';
import { TransitionSheet } from './TransitionSheet';
import { AnimationFieldsList } from './sceneFields';
import { WatermarkField } from './watermark-fields';
import type { EditorState, AudioMix } from '../model/templateEditorModel';

type Normalize = 'off' | 'loudnorm' | 'dynaudnorm';

interface StyleAudioStepProps {
  state: EditorState;
  t: TFunction<'editor'>;
  onPatch: (p: Partial<EditorState>) => void;
}

export const StyleAudioStep = ({ state, t, onPatch }: StyleAudioStepProps) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { defaultTransition, audio } = state;

  const setAudio = (p: Partial<AudioMix>) => {
    onPatch({ audio: { ...audio, ...p } });
  };

  const setNormalize = (choice: Normalize) => {
    if (choice === 'off') {
      const { normalize: _drop, ...rest } = audio;

      onPatch({ audio: rest });

      return;
    }

    setAudio({ normalize: choice });
  };

  const transitionLabel =
    defaultTransition.type === 'cut'
      ? t('transition.cut')
      : `${defaultTransition.type} · ${defaultTransition.duration}s`;

  return (
    <View>
      <Text style={styles.label}>{t('style.defaultTransition')}</Text>
      <Text style={styles.help}>{t('style.defaultTransitionHelp')}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('style.defaultTransition')}
        testID="default-transition"
        onPress={() => {
          setSheetOpen(true);
        }}
        style={styles.pickerRow}
      >
        <Ionicons name="swap-horizontal" size={18} color={colors.primary} />
        <Text style={styles.pickerValue}>{transitionLabel}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      <Text style={[styles.label, { marginTop: spacing.l }]}>{t('style.globalAudio')}</Text>

      <Slider
        label={t('audio.sourceVolume')}
        value={audio.sourceVolume}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(sourceVolume) => {
          setAudio({ sourceVolume });
        }}
      />
      <Slider
        label={t('audio.musicVolumeGlobalLabel')}
        value={audio.musicVolume}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(musicVolume) => {
          setAudio({ musicVolume });
        }}
      />

      <Segmented<Normalize>
        label={t('audio.normalize')}
        value={audio.normalize ?? 'off'}
        options={[
          { value: 'off', label: t('audio.normalizeOff') },
          { value: 'loudnorm', label: t('audio.normalizeLoudnorm') },
          { value: 'dynaudnorm', label: t('audio.normalizeDynaudnorm') },
        ]}
        onChange={setNormalize}
      />

      <View style={styles.duckRow}>
        <Text style={styles.duckLabel}>{t('audio.ducking')}</Text>
        <Segmented
          value={audio.ducking ? 'on' : 'off'}
          options={[
            { value: 'off', label: t('motion.off') },
            { value: 'on', label: t('motion.on') },
          ]}
          onChange={(v) => {
            setAudio({ ducking: v === 'on' });
          }}
        />
      </View>

      <Text style={[styles.label, { marginTop: spacing.l }]}>{t('style.wholeVideoAnimations')}</Text>
      <Text style={styles.help}>{t('style.wholeVideoAnimationsHelp')}</Text>
      <AnimationFieldsList
        value={state.globalAnimations}
        onChange={(globalAnimations) => {
          onPatch({ globalAnimations: globalAnimations ?? [] });
        }}
        t={t}
      />

      <Text style={[styles.label, { marginTop: spacing.l }]}>{t('style.watermark')}</Text>
      <Text style={styles.help}>{t('style.watermarkHelp')}</Text>
      <WatermarkField
        value={state.watermark}
        onChange={(watermark) => {
          onPatch({ watermark });
        }}
        t={t}
      />

      <TransitionSheet
        visible={sheetOpen}
        t={t}
        transition={defaultTransition.type === 'cut' ? undefined : defaultTransition}
        onClose={() => {
          setSheetOpen(false);
        }}
        onChange={(transition) => {
          onPatch({
            defaultTransition: transition
              ? { type: transition.type, duration: transition.duration ?? defaultTransition.duration }
              : { type: 'cut', duration: defaultTransition.duration },
          });
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  label: {
    ...typography.smallText,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  help: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.s },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    minHeight: 52,
    paddingHorizontal: spacing.m,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  pickerValue: { ...typography.body, color: colors.text, flex: 1, textTransform: 'capitalize' },
  duckRow: { marginTop: spacing.m },
  duckLabel: {
    ...typography.smallText,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
});
