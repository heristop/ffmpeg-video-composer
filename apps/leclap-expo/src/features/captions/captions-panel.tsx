import React, { useState } from 'react';
import { View, Text, Switch, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, fonts, spacing } from '@/src/styles/theme';
import { styles as previewStyles } from '@/src/features/editor/preview/previewStyles';
import { editWord, type SectionCaptions } from './caption-store';
import type { CaptionsStatus } from './use-section-captions';
import type { TranscriptWord } from './transcript-mapping';

interface CaptionsPanelProps {
  captions: SectionCaptions | null;
  enabled: boolean;
  status: CaptionsStatus;
  error: string | null;
  onToggle: (enabled: boolean) => void;
  onWordsChange: (words: TranscriptWord[]) => void;
  onRetry: () => void;
  onClose: () => void;
}

const KNOWN_ERRORS = new Set(['unavailable', 'permission', 'empty']);

/** One word chip: tap to fix it in place; clearing it removes the word, spaces split it. */
function WordChip({ word, onCommit }: { word: TranscriptWord; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    return (
      <TextInput
        autoFocus
        value={draft}
        onChangeText={setDraft}
        // A single-line input blurs on submit, so the commit happens once, on blur.
        onBlur={() => {
          onCommit(draft);
          setDraft(null);
        }}
        style={[local.chip, local.chipEditing]}
        returnKeyType="done"
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={word.text}
      onPress={() => {
        setDraft(word.text);
      }}
      style={[local.chip, (word.confidence ?? 1) < 0.5 && local.chipUnsure]}
    >
      <Text style={local.chipText}>{word.text}</Text>
    </Pressable>
  );
}

function CaptionsBody({ captions, status, error, onWordsChange, onRetry }: CaptionsPanelProps) {
  const { t } = useTranslation('preview');

  if (status === 'working') {
    return (
      <View style={local.row}>
        <ActivityIndicator color={colors.surface} />
        <Text style={local.note}>{t('captions.working')}</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={local.row}>
        <Text style={local.error}>
          {KNOWN_ERRORS.has(error ?? '') ? t(`captions.errors.${error as 'unavailable'}`) : error}
        </Text>
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={local.link}>{t('captions.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!captions) return <Text style={local.note}>{t('captions.privacy')}</Text>;

  return (
    <>
      <Text style={local.note}>{captions.coarse ? t('captions.coarse') : t('captions.tapToFix')}</Text>
      <ScrollView style={local.words} contentContainerStyle={local.wordsContent}>
        {captions.words.map((word, index) => (
          <WordChip
            key={`${index}-${word.start}`}
            word={word}
            onCommit={(text) => {
              if (text !== word.text) onWordsChange(editWord(captions.words, index, text));
            }}
          />
        ))}
      </ScrollView>
    </>
  );
}

/** Bottom panel of the preview's captions mode: the on-device captions toggle and the word editor. */
export function CaptionsPanel(props: CaptionsPanelProps) {
  const { t } = useTranslation('preview');

  return (
    <View style={previewStyles.editPanel}>
      <View style={local.header}>
        <Text style={previewStyles.editTitle}>{t('captions.title')}</Text>
        <Switch
          accessibilityLabel={t('captions.toggle')}
          value={props.enabled}
          disabled={props.status === 'working'}
          onValueChange={props.onToggle}
          trackColor={{ true: colors.primary, false: 'rgba(255,255,255,0.25)' }}
        />
      </View>
      <CaptionsBody {...props} />
      <View style={previewStyles.editActions}>
        <Pressable style={previewStyles.primaryButton} onPress={props.onClose} accessibilityRole="button">
          <Text style={previewStyles.primaryButtonText}>{t('actions.done', { ns: 'common' })}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.m,
  },
  row: { alignItems: 'center', gap: spacing.s, paddingHorizontal: spacing.l },
  note: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: fonts.inter.medium,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: spacing.l,
  },
  error: { color: colors.error, fontFamily: fonts.inter.medium, fontSize: 14, textAlign: 'center' },
  link: { color: colors.accent, fontFamily: fonts.poppins.semiBold, fontSize: 14 },
  words: { maxHeight: 180, marginTop: spacing.s },
  wordsContent: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.l },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.s,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    minHeight: 32,
    justifyContent: 'center',
  },
  chipUnsure: { borderWidth: 1, borderColor: colors.accent },
  chipEditing: { color: colors.surface, borderWidth: 1, borderColor: colors.primary, minWidth: 64 },
  chipText: { color: colors.surface, fontFamily: fonts.inter.medium, fontSize: 15 },
});
