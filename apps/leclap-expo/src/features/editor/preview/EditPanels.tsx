import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import TrimPanel, { type TrimRange } from '@/src/features/editor/components/TrimPanel';
import { styles } from './previewStyles';

/** Bottom panel shown in captions mode (on-device transcription + word editor). */
export { SectionCaptions as CaptionsEditPanel } from '@/src/features/captions/section-captions';

interface TrimEditPanelProps {
  duration: number;
  value: TrimRange;
  currentTime: number;
  onChange: (next: TrimRange) => void;
  onSeek: (seconds: number) => void;
  onCancel: () => void;
  onApply: () => void;
}

/** Bottom panel shown in trim mode. */
export function TrimEditPanel({
  duration,
  value,
  currentTime,
  onChange,
  onSeek,
  onCancel,
  onApply,
}: TrimEditPanelProps) {
  const { t } = useTranslation('preview');

  return (
    <View style={styles.editPanel}>
      <Text style={styles.editTitle}>{t('trim.title')}</Text>
      <TrimPanel duration={duration} value={value} currentTime={currentTime} onChange={onChange} onSeek={onSeek} />
      <View style={styles.editActions}>
        <TouchableOpacity style={styles.ghostButton} onPress={onCancel} activeOpacity={0.8}>
          <Text style={styles.ghostButtonText}>{t('actions.cancel', { ns: 'common' })}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={onApply} activeOpacity={0.85}>
          <Text style={styles.primaryButtonText}>{t('actions.done', { ns: 'common' })}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface CropEditPanelProps {
  onReset: () => void;
  onCancel: () => void;
  onApply: () => void;
}

/** Bottom panel shown in crop mode. */
export function CropEditPanel({ onReset, onCancel, onApply }: CropEditPanelProps) {
  const { t } = useTranslation('preview');

  return (
    <View style={styles.editPanel}>
      <Text style={styles.editTitle}>{t('crop.title')}</Text>
      <View style={styles.editActions}>
        <TouchableOpacity style={styles.ghostButton} onPress={onReset} activeOpacity={0.8}>
          <Text style={styles.ghostButtonText}>{t('actions.reset', { ns: 'common' })}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostButton} onPress={onCancel} activeOpacity={0.8}>
          <Text style={styles.ghostButtonText}>{t('actions.cancel', { ns: 'common' })}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={onApply} activeOpacity={0.85}>
          <Text style={styles.primaryButtonText}>{t('actions.done', { ns: 'common' })}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
