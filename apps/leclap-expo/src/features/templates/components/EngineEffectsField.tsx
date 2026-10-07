// The engine effects of a visual scene (section.graphics): the two-part recipes, a strip of the library's
// engine primitives (each pick inserts that primitive drafted for this scene: its default target and
// context-derived parameters) and the effects already placed, each removable. Fine-tuning happens in the
// web builder's parameter panel; the device writes the same descriptor fields. Mirrors the web picker's
// engine groups.
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View, ScrollView } from 'react-native';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import { colors, spacing, typography } from '@/src/styles/theme';
import { enginePoster } from '@/src/data/mediaCatalog';
import {
  ANIMATION_EFFECT_PRESETS,
  ENGINE_LIBRARY,
  draftGraphic,
  libraryEntryOfGraphic,
  libraryLabelKey,
  type EditorSection,
  type Orientation,
} from '../model/templateEditorModel';

interface EngineEffectsFieldProps {
  section: EditorSection;
  orientation: Orientation;
  /** Mixed into a fresh effect's seed (the scene's index). */
  salt?: number;
  onChange: (graphics: Graphic[] | undefined) => void;
  t: TFunction<'editor'>;
}

const graphicsOf = (section: EditorSection): Graphic[] => ('graphics' in section ? section.graphics : undefined) ?? [];

export const EngineEffectsField = ({ section, orientation, salt, onChange, t }: EngineEffectsFieldProps) => {
  const graphics = graphicsOf(section);
  const add = (added: Graphic[]) => {
    onChange([...graphics, ...added]);
  };

  return (
    <View>
      <Text style={[styles.label, { marginTop: spacing.m }]}>{t('animation.engine.engineLabel')}</Text>
      <Text style={styles.help}>{t('animation.engine.engineHelp')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {ENGINE_LIBRARY.map((entry) => {
          const label = t(libraryLabelKey(entry.id));
          const poster = enginePoster(entry.kind, entry.id);

          return (
            <TouchableOpacity
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={t('animation.engine.addEffect', { label })}
              testID={`engine-effect-${entry.id}`}
              style={styles.card}
              onPress={() => {
                add([draftGraphic(entry, { section, orientation, salt })]);
              }}
            >
              <View style={styles.thumb}>
                {poster ? (
                  <Image source={poster} style={styles.thumbImg} resizeMode="cover" />
                ) : (
                  <Ionicons name="sparkles-outline" size={18} color={colors.textSecondary} />
                )}
              </View>
              <Text style={styles.cardLabel} numberOfLines={1}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <Text style={[styles.label, { marginTop: spacing.m }]}>{t('animation.effects.label')}</Text>
      {ANIMATION_EFFECT_PRESETS.map((preset) => (
        <TouchableOpacity
          key={preset.id}
          accessibilityRole="button"
          accessibilityLabel={t(preset.nameKey)}
          testID={`animation-effect-${preset.id}`}
          style={styles.preset}
          onPress={() => {
            add(preset.build({ section, orientation, salt }));
          }}
        >
          <View style={styles.presetHeading}>
            <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
            <Text style={styles.presetTitle}>{t(preset.nameKey)}</Text>
            <Ionicons name="add" size={18} color={colors.primary} />
          </View>
          <Text style={styles.presetDescription}>{t(preset.descriptionKey)}</Text>
        </TouchableOpacity>
      ))}
      {graphics.length > 0 ? (
        <View style={{ marginTop: spacing.m }}>
          <Text style={styles.label}>{t('animation.engine.added')}</Text>
          {graphics.map((graphic, index) => {
            const entry = libraryEntryOfGraphic(graphic);
            const label = entry ? t(libraryLabelKey(entry.id)) : graphic.type;

            return (
              <View key={`${graphic.type}-${index}`} style={styles.row}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {label}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('animation.engine.removeEffect', { label })}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => {
                    const next = graphics.filter((_, i) => i !== index);

                    onChange(next.length > 0 ? next : undefined);
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  label: { ...typography.caption, color: colors.text, fontWeight: '600' },
  help: { ...typography.smallText, color: colors.textSecondary, marginTop: 2 },
  strip: { gap: spacing.s, paddingVertical: spacing.xs, paddingRight: spacing.s },
  card: { width: 104, borderRadius: 12, borderWidth: 1, borderColor: colors.divider, padding: 4 },
  thumb: {
    height: 58,
    borderRadius: 8,
    backgroundColor: '#1A1D24',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  cardLabel: { ...typography.smallText, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
  preset: {
    minHeight: 44,
    marginTop: spacing.s,
    padding: spacing.s,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  presetHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  presetTitle: { ...typography.caption, color: colors.text, fontWeight: '600', flex: 1 },
  presetDescription: { ...typography.smallText, color: colors.textSecondary, marginTop: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
    minHeight: 44,
  },
  rowLabel: { ...typography.body, fontSize: 14, color: colors.text, flex: 1 },
});
