// Whole-video image watermark (descriptor global.watermark): a still logo composited in one corner
// over every section, authored once. Mirrors the web GlobalWatermarkField (image picker + corner +
// scale/opacity/margin sliders), but Expo offers bundled library + a pasted URL only — no upload tab.
// Reason: apps/leclap-expo/src/services/compile/compileOnDevice.ts accepts `mediaChoices` but never
// forwards them to CoreCompilationService.compile() (commented there as reserved for future use), so a
// user-picked file has no route to the on-device engine today. Fixing that is a separate follow-up.
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image, StyleSheet } from 'react-native';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { WATERMARK_POSITIONS } from 'ffmpeg-video-composer/src/schemas/global.schemas.ts';
import { colors, spacing, typography } from '@/src/styles/theme';
import { BACKGROUND_LIBRARY, backgroundAsset } from '@/src/data/mediaCatalog';
import { Slider, Segmented } from './EditorControls';
import type { WatermarkChoice, WatermarkPosition, MediaChoice } from '../model/templateEditorModel';

// Engine defaults (global.schemas.ts WatermarkSchema) — the sliders' reset targets and the values
// implied while the author never touches a control.
const DEFAULT_POSITION: WatermarkPosition = 'bottom-right';
const DEFAULT_SCALE = 0.12;
const DEFAULT_OPACITY = 0.8;
const DEFAULT_MARGIN = 24;

type ImageSource = 'library' | 'url';

const sourceOf = (image: MediaChoice | undefined): ImageSource => (image?.source === 'url' ? 'url' : 'library');

interface WatermarkFieldProps {
  value: WatermarkChoice | undefined;
  onChange: (value?: WatermarkChoice) => void;
  t: TFunction<'editor'>;
}

const WatermarkSource = ({
  mode,
  value,
  urlDraft,
  setUrlDraft,
  setImage,
  clear,
  t,
}: {
  mode: ImageSource;
  value: WatermarkChoice | undefined;
  urlDraft: string;
  setUrlDraft: (value: string) => void;
  setImage: (image: MediaChoice) => void;
  clear: () => void;
  t: TFunction<'editor'>;
}) =>
  mode === 'library' ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      <WatermarkCard label={t('watermark.none')} active={!value} onPress={clear} icon="ban-outline" />
      {BACKGROUND_LIBRARY.map((background) => (
        <WatermarkCard
          key={background.id}
          label={background.title}
          active={value?.image.source === 'library' && value.image.id === background.id}
          onPress={() => {
            setImage({ source: 'library', id: background.id });
          }}
          source={backgroundAsset(background.id)}
        />
      ))}
    </ScrollView>
  ) : (
    <View style={styles.urlRow}>
      <TextInput
        testID="watermark-url-input"
        style={styles.urlInput}
        value={urlDraft}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={t('watermark.urlPlaceholder')}
        placeholderTextColor={colors.textSecondary}
        onChangeText={(text) => {
          setUrlDraft(text);

          if (text.trim() === '') {
            clear();

            return;
          }

          setImage({ source: 'url', url: text.trim() });
        }}
      />
    </View>
  );

const WatermarkControls = ({
  value,
  patch,
  t,
}: {
  value: WatermarkChoice | undefined;
  patch: (over: Partial<WatermarkChoice>) => void;
  t: TFunction<'editor'>;
}) =>
  value ? (
    <>
      <Segmented<WatermarkPosition>
        label={t('watermark.position')}
        value={value.position ?? DEFAULT_POSITION}
        options={WATERMARK_POSITIONS.map((pos) => ({ value: pos, label: t(`watermark.pos.${pos}`) }))}
        onChange={(position) => {
          patch({ position });
        }}
      />
      <Slider
        label={t('watermark.scale')}
        value={value.scale ?? DEFAULT_SCALE}
        min={0.02}
        max={0.5}
        step={0.01}
        resetTo={DEFAULT_SCALE}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(scale) => {
          patch({ scale });
        }}
      />
      <Slider
        label={t('watermark.opacity')}
        value={value.opacity ?? DEFAULT_OPACITY}
        min={0}
        max={1}
        step={0.05}
        resetTo={DEFAULT_OPACITY}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(opacity) => {
          patch({ opacity });
        }}
      />
      <Slider
        label={t('watermark.margin')}
        value={value.margin ?? DEFAULT_MARGIN}
        min={0}
        max={200}
        step={1}
        resetTo={DEFAULT_MARGIN}
        format={(v) => `${v}px`}
        onChange={(margin) => {
          patch({ margin });
        }}
      />
    </>
  ) : null;

export const WatermarkField = ({ value, onChange, t }: WatermarkFieldProps) => {
  // Local tab state (like sceneFields.tsx's OverlaysField `kind`): independent of the chosen
  // MediaChoice so tapping "URL" opens the input even before anything has been typed into it.
  const [mode, setMode] = React.useState<ImageSource>(sourceOf(value?.image));
  const [urlDraft, setUrlDraft] = React.useState(value?.image.source === 'url' ? value.image.url : '');

  const setImage = (image: MediaChoice) => {
    onChange(value ? { ...value, image } : { image });
  };

  const patch = (over: Partial<WatermarkChoice>) => {
    if (!value) return;

    onChange({ ...value, ...over });
  };

  const clear = () => {
    onChange();
  };

  return (
    <View>
      <Segmented<ImageSource>
        label={t('watermark.source')}
        value={mode}
        options={[
          { value: 'library', label: t('watermark.sourceLibrary'), icon: 'images-outline' },
          { value: 'url', label: t('watermark.sourceUrl'), icon: 'link-outline' },
        ]}
        onChange={setMode}
      />

      <WatermarkSource
        mode={mode}
        value={value}
        urlDraft={urlDraft}
        setUrlDraft={setUrlDraft}
        setImage={setImage}
        clear={clear}
        t={t}
      />
      <WatermarkControls value={value} patch={patch} t={t} />
    </View>
  );
};

const WatermarkCard = ({
  label,
  active,
  onPress,
  source,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  source?: number;
  icon?: keyof typeof Ionicons.glyphMap;
}) => (
  <TouchableOpacity
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={label}
    onPress={onPress}
    style={[styles.card, active && styles.cardActive]}
  >
    <View style={styles.thumb}>
      {source ? (
        <Image source={source} style={styles.thumbImg} resizeMode="cover" />
      ) : (
        <Ionicons name={icon ?? 'image-outline'} size={18} color={colors.textSecondary} />
      )}
    </View>
    <Text style={[styles.cardLabel, active && { color: colors.primary }]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  strip: { gap: spacing.s, paddingVertical: spacing.xs, paddingRight: spacing.s, marginTop: spacing.s },
  card: { width: 88, borderRadius: 12, borderWidth: 1, borderColor: colors.divider, padding: 4 },
  cardActive: { borderColor: colors.primary, backgroundColor: 'rgba(124,131,253,0.08)' },
  thumb: {
    height: 54,
    borderRadius: 8,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  cardLabel: { ...typography.smallText, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
  urlRow: { marginTop: spacing.s },
  urlInput: {
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
});
