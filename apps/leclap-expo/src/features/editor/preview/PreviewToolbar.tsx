import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/src/styles/theme';
import { styles } from './previewStyles';

function ToolButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.toolButton}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Ionicons name={icon} size={24} color={active ? colors.accent : colors.surface} />
      <Text style={[styles.toolButtonText, active && { color: colors.accent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

interface PreviewToolbarProps {
  saving: boolean;
  canEdit: boolean;
  trimActive: boolean;
  cropActive: boolean;
  onExport?: () => void;
  onDone: () => void;
  onTrim: () => void;
  onCrop: () => void;
  onRetake: () => void;
  /** A recorded video step: offers the on-device captions editor. */
  canCaption?: boolean;
  captionsActive?: boolean;
  onCaptions?: () => void;
}

/** Recorded clips offer editing; finished outputs offer export. */
export function PreviewToolbar({
  saving,
  canEdit,
  trimActive,
  cropActive,
  onExport,
  onDone,
  onTrim,
  onCrop,
  onRetake,
  canCaption,
  captionsActive,
  onCaptions,
}: PreviewToolbarProps) {
  const { t } = useTranslation('preview');

  return (
    <>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onDone}
        activeOpacity={0.7}
        disabled={saving}
        accessibilityLabel={t('toolbar.saveAndClose')}
      >
        {saving ? <ActivityIndicator color="#000" /> : <Ionicons name="checkmark" size={32} color="#000" />}
      </TouchableOpacity>

      <View style={styles.toolbar}>
        {onExport && <ToolButton icon="share-outline" label={t('export.title')} onPress={onExport} />}
        {canEdit && <ToolButton icon="cut-outline" label={t('toolbar.trim')} active={trimActive} onPress={onTrim} />}
        {canEdit && <ToolButton icon="crop-outline" label={t('toolbar.crop')} active={cropActive} onPress={onCrop} />}
        {canCaption && onCaptions && (
          <ToolButton
            icon="chatbox-ellipses-outline"
            label={t('toolbar.captions')}
            active={captionsActive}
            onPress={onCaptions}
          />
        )}
        {canEdit && <ToolButton icon="refresh" label={t('toolbar.retake')} onPress={onRetake} />}
      </View>
    </>
  );
}
