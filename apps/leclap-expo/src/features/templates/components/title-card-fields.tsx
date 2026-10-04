// Title-card panel for color_background sections — the RN mirror of the web TitleCardField. Kicker /
// headline / subtitle text (with tap-to-insert variable chips, since RN has no `#`-autocomplete), an
// accent colour, alignment, a card background/fade colour and auto fade-in/out toggles. Lowers to the
// descriptor `titleCard` sugar verbatim; clearing every line removes the card.
// Deliberately mirrors CaptionFields' scope: the web panel's per-line font/size/colour overrides
// (kickerStyle/headlineStyle/subtitleStyle) and its reveal/text-effect controls are skipped — no RN
// font-picker, reveal or text-effect control exists elsewhere in the app yet, so authoring those
// stays a web-only capability for now.
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import type { TFunction } from 'i18next';
import { colors, spacing, typography } from '@/src/styles/theme';
import { Segmented, Slider } from './EditorControls';
import { FieldRow, Toggle, ColorField } from './sceneFields';
import { FEATURE_CONTROLS, type TitleCard } from '../model/templateEditorModel';

const DEFAULT_BACKGROUND = '#000000';
type Align = NonNullable<TitleCard['align']>;

const STAGGER_SPEC = FEATURE_CONTROLS.titleCard.find((spec) => spec.fieldPath === 'titleCard.stagger');
const STAGGER_MIN = STAGGER_SPEC?.min ?? 0;
const STAGGER_MAX = STAGGER_SPEC?.max ?? 1;
const ALIGN_SPEC = FEATURE_CONTROLS.titleCard.find((spec) => spec.fieldPath === 'titleCard.align');
const ALIGN_LABEL_KEY: Record<string, string> = { left: 'alignLeft', center: 'alignCenter' };

function lineText(line: TitleCard['headline']): string {
  return line?.en ?? '';
}

function hasAnyText(card: TitleCard): boolean {
  return [card.kicker, card.headline, card.subtitle].some((line) => lineText(line).trim() !== '');
}

// Merge a patch over the current card; clear the whole card once no line has text.
function nextTitleCard(current: TitleCard | undefined, patch: Partial<TitleCard>): TitleCard | undefined {
  const merged: TitleCard = { ...current, ...patch };

  return hasAnyText(merged) ? merged : undefined;
}

function setLine(value: string): TitleCard['headline'] | undefined {
  return value.trim() === '' ? undefined : { en: value };
}

interface TitleCardFieldsProps {
  value: TitleCard | undefined;
  t: TFunction<'editor'>;
  variables: string[];
  onChange: (value: TitleCard | undefined) => void;
}

export const TitleCardFields = ({ value, t, variables, onChange }: TitleCardFieldsProps) => {
  const card = value;

  const patch = (next: Partial<TitleCard>) => {
    onChange(nextTitleCard(card, next));
  };

  return (
    <View>
      <Text style={styles.hint}>{t('titleCard.hint')}</Text>
      <TextLine
        label={t('titleCard.kicker')}
        placeholder={t('titleCard.kickerPlaceholder')}
        value={lineText(card?.kicker)}
        variables={variables}
        t={t}
        onChange={(v) => {
          patch({ kicker: setLine(v) });
        }}
      />
      <TextLine
        label={t('titleCard.headline')}
        placeholder={t('titleCard.headlinePlaceholder')}
        value={lineText(card?.headline)}
        variables={variables}
        t={t}
        onChange={(v) => {
          patch({ headline: setLine(v) });
        }}
      />
      <TextLine
        label={t('titleCard.subtitle')}
        placeholder={t('titleCard.subtitlePlaceholder')}
        value={lineText(card?.subtitle)}
        variables={variables}
        t={t}
        onChange={(v) => {
          patch({ subtitle: setLine(v) });
        }}
      />
      {card && hasAnyText(card) ? <TitleCardOptions card={card} t={t} patch={patch} /> : null}
    </View>
  );
};

// The card-wide options (accent / alignment / background / fades), shown once the card has any text.
// Split out of TitleCardFields to keep that component's branching within the complexity budget —
// mirrors the web CardOptions split in TitleCardField.tsx.
const TitleCardOptions = ({
  card,
  t,
  patch,
}: {
  card: TitleCard;
  t: TFunction<'editor'>;
  patch: (next: Partial<TitleCard>) => void;
}) => (
  <View>
    <AccentField
      hint={t('accent.hintTitleCard')}
      accent={card.accent}
      t={t}
      onChange={(accent) => {
        patch({ accent });
      }}
    />
    <Segmented<Align>
      label={t('titleCard.align')}
      value={card.align ?? 'left'}
      options={(ALIGN_SPEC?.enumValues ?? []).map((v) => ({
        value: v as Align,
        label: t(`titleCard.${ALIGN_LABEL_KEY[v] ?? v}`),
      }))}
      onChange={(next) => {
        patch({ align: next });
      }}
    />
    <Slider
      label={t('titleCard.stagger')}
      value={card.stagger ?? 0.15}
      min={STAGGER_MIN}
      max={STAGGER_MAX}
      step={0.01}
      resetTo={0.15}
      format={(value) => `${value}s`}
      onChange={(stagger) => {
        patch({ stagger: stagger === 0.15 ? undefined : stagger });
      }}
    />
    <ColorField
      label={t('titleCard.background')}
      value={card.background ?? DEFAULT_BACKGROUND}
      onChange={(background) => {
        patch({ background });
      }}
    />
    <Toggle
      label={t('titleCard.fadeIn')}
      value={card.fade?.in ?? true}
      onChange={(on) => {
        patch({ fade: { ...card.fade, in: on } });
      }}
    />
    <Toggle
      label={t('titleCard.fadeOut')}
      value={card.fade?.out ?? true}
      onChange={(on) => {
        patch({ fade: { ...card.fade, out: on } });
      }}
    />
  </View>
);

// The shared accent toggle + colour, reused by titleCard and lowerThird (mirrors the web
// AccentControl's structural — non-geometry — mode: `undefined` means no accent bar; toggling on
// seeds the house brand colour).
const AccentField = ({
  hint,
  accent,
  t,
  onChange,
}: {
  hint: string;
  accent: string | undefined;
  t: TFunction<'editor'>;
  onChange: (accent: string | undefined) => void;
}) => {
  const enabled = accent !== undefined;

  return (
    <View>
      <Toggle
        label={t('accent.enable')}
        value={enabled}
        onChange={(on) => {
          onChange(on ? colors.primary : undefined);
        }}
      />
      {enabled ? <ColorField label={t('accent.color')} value={accent} onChange={onChange} /> : null}
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
};

// One labelled text line — shared by kicker / headline / subtitle. RN has no in-field `#`-autocomplete
// (the web VariableTextField), so in-scope variables surface as tap-to-insert chips beneath the input,
// mirroring OverlayPositioner's variable row.
const TextLine = ({
  label,
  placeholder,
  value,
  variables,
  t,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  variables: string[];
  t: TFunction<'editor'>;
  onChange: (value: string) => void;
}) => (
  <FieldRow label={label}>
    <>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
      />
      {variables.length > 0 ? (
        <View style={styles.varChips}>
          {variables.map((name) => (
            <TouchableOpacity
              key={name}
              accessibilityRole="button"
              accessibilityLabel={`${t('overlay.insertVariable')} ${name}`}
              onPress={() => {
                onChange(`${value}{{ ${name} }}`);
              }}
              style={styles.varChip}
            >
              <Text style={styles.varChipText} numberOfLines={1}>
                {name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </>
  </FieldRow>
);

const styles = StyleSheet.create({
  hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.s },
  input: {
    ...typography.body,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.s,
    paddingVertical: 8,
  },
  varChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  varChip: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
  },
  varChipText: { ...typography.smallText, color: colors.primary },
});
