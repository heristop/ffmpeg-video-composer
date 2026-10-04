import { Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import type { Template } from '@/src/types';
import { colors, spacing, typography, withAlpha } from '@/src/styles/theme';
import { PressableScale } from '@/src/components/kinetic/pressable-scale';
import { templatePresentation } from '../template-presentation';
import { templatePosters } from '../template-posters';

interface TemplateCardProps {
  template: Template;
  onPress: (template: Template) => void;
}

export default function TemplateCard({ template, onPress }: TemplateCardProps) {
  const { t, i18n } = useTranslation('templates');
  const { title, description, orientation } = templatePresentation(template, i18n.resolvedLanguage ?? i18n.language);
  const poster = template.source === 'sample' && template.id ? templatePosters[template.id] : undefined;
  const format = { portrait: '9:16', square: '1:1', landscape: '16:9' }[orientation];
  const orientationLabel = t(`orientation.${orientation}`);

  return (
    <PressableScale
      onPress={() => {
        onPress(template);
      }}
      haptic={false}
      scaleTo={0.98}
      accessibilityLabel={`${title}. ${orientationLabel}. ${description ?? t('cardDefaultDescription')}`}
      style={styles.card}
    >
      <View style={[styles.cover, !poster && styles.customCover]}>
        {poster ? (
          <Image source={poster} style={styles.poster} resizeMode="contain" accessible={false} />
        ) : (
          <Ionicons
            name={template.source === 'user' ? 'sparkles-outline' : 'film-outline'}
            size={32}
            color={colors.primaryDark}
          />
        )}
        {template.source === 'user' ? <Text style={styles.customBadge}>{t('custom')}</Text> : null}
      </View>
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.description} numberOfLines={2}>
          {description ?? t('cardDefaultDescription')}
        </Text>
        <View style={styles.metadata}>
          <Text style={styles.format}>{format}</Text>
          <Text style={styles.orientation}>{orientationLabel}</Text>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexGrow: 1, backgroundColor: colors.surfaceRaised, borderRadius: 16, overflow: 'hidden' },
  cover: {
    aspectRatio: 4 / 3,
    overflow: 'hidden',
    backgroundColor: colors.textStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poster: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  customCover: { backgroundColor: colors.primaryMuted },
  customBadge: { ...typography.smallText, color: colors.primaryDark, marginTop: spacing.s, fontWeight: '600' },
  copy: { flexGrow: 1, padding: spacing.m, gap: spacing.s, backgroundColor: colors.surfaceRaised },
  title: { ...typography.heading, color: colors.text, lineHeight: 26 },
  description: { ...typography.caption, lineHeight: 20 },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.s,
    marginTop: 'auto',
    paddingTop: spacing.xs,
  },
  format: {
    ...typography.smallText,
    color: colors.primaryDark,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: withAlpha(colors.primary, 0.1),
  },
  orientation: { ...typography.smallText, color: colors.textSecondary, flexShrink: 1 },
});
