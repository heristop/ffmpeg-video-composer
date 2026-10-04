import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Sheet } from '@/src/features/templates/components/Sheet';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Clappy } from '@/src/components/clappy/Clappy';
import { colors, spacing, typography, withAlpha } from '@/src/styles/theme';

interface ExportSheetProps {
  visible: boolean;
  videoUri: string;
  onClose: () => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type UploadState = 'idle' | 'uploading' | 'done' | 'error';

function useSaveToGallery() {
  const { t } = useTranslation('preview');
  const [state, setState] = useState<SaveState>('idle');

  const save = async (uri: string) => {
    setState('saving');

    try {
      const { requestMediaLibraryPermission } = await import('@/src/utils/permissions');
      const { Asset } = await import('expo-media-library');
      const granted = await requestMediaLibraryPermission();

      if (!granted) {
        setState('idle');

        return;
      }
      await Asset.create(uri);
      setState('saved');
    } catch {
      setState('error');
      Alert.alert(t('export.saveErrorTitle'), t('export.saveErrorBody'));
    }
  };

  return { state, save };
}

function useUpload() {
  const { t } = useTranslation('preview');
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [url, setUrl] = useState('');

  const upload = async (videoUri: string) => {
    if (!url.trim()) {
      Alert.alert(t('export.missingUrlTitle'), t('export.missingUrlBody'));

      return;
    }

    setState('uploading');
    setProgress(0);

    try {
      const body = new FormData();
      body.append('file', { uri: videoUri, name: 'video.mp4', type: 'video/mp4' } as unknown as Blob);

      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();

            return;
          }

          reject(new Error(`HTTP ${xhr.status}`));
        };
        xhr.onerror = () => {
          reject(new Error('Network error'));
        };
        xhr.open('POST', url.trim());
        xhr.send(body);
      });

      setState('done');
    } catch (error) {
      setState('error');
      const message = error instanceof Error ? error.message : t('export.uploadErrorTitle');
      Alert.alert(t('export.uploadErrorTitle'), message);
    }
  };

  return { state, progress, url, setUrl, upload };
}

interface ActionRowProps {
  label: string;
  sublabel?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
}

const ActionRow = ({ label, sublabel, onPress, disabled, busy, icon }: ActionRowProps) => (
  <TouchableOpacity
    style={[styles.actionRow, disabled && styles.actionRowDisabled]}
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled, busy }}
  >
    <Ionicons name={icon} size={24} color={colors.primaryDark} accessible={false} />
    <View style={styles.actionRowText}>
      <Text style={styles.actionLabel}>{label}</Text>
      {sublabel ? <Text style={styles.actionSublabel}>{sublabel}</Text> : null}
    </View>
    {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
  </TouchableOpacity>
);

const saveLabel = (state: SaveState, t: TFunction<'preview'>): string => t(`export.save.${state}`);
const uploadLabel = (state: UploadState, progress: number, t: TFunction<'preview'>): string =>
  t(`export.upload.${state}`, { percent: progress });

// An output owns its entire export session. Pending work from the previous output can only
// update its unmounted session, never disable actions for the new file.
export const ExportSheet = (props: ExportSheetProps) => <ExportSession key={props.videoUri} {...props} />;

const ExportSession = ({ visible, videoUri, onClose }: ExportSheetProps) => {
  const { t } = useTranslation('preview');
  const [uploadOpen, setUploadOpen] = useState(false);
  const { state: saveState, save } = useSaveToGallery();
  const { state: uploadState, progress, url, setUrl, upload } = useUpload();

  const [sharing, setSharing] = useState(false);
  const handleShare = async () => {
    setSharing(true);

    try {
      const { isAvailableAsync, shareAsync } = await import('expo-sharing');

      if (!(await isAvailableAsync())) throw new Error('Sharing unavailable');
      await shareAsync(videoUri, {
        mimeType: 'video/mp4',
        UTI: 'public.mpeg-4',
        dialogTitle: t('export.shareTitle'),
      });
    } catch {
      Alert.alert(t('export.shareErrorTitle'), t('export.shareErrorBody'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Sheet visible={visible} title={t('export.title')} onClose={onClose}>
      <View style={styles.content}>
        <View style={styles.ready}>
          <Clappy size={80} state="success" active={visible} />
          <View style={styles.readyCopy}>
            <Text style={styles.readyTitle}>{t('export.readyTitle')}</Text>
            <Text style={styles.actionSublabel}>{t('export.readyBody')}</Text>
          </View>
        </View>
        <ActionRow
          icon="download-outline"
          label={saveLabel(saveState, t)}
          sublabel={t('export.saveBody')}
          onPress={() => {
            save(videoUri).catch(() => {});
          }}
          disabled={saveState === 'saving' || saveState === 'saved'}
          busy={saveState === 'saving'}
        />

        <ActionRow
          icon="share-outline"
          label={t('export.share')}
          sublabel={t('export.shareBody')}
          onPress={() => {
            handleShare().catch(() => {});
          }}
          disabled={sharing}
          busy={sharing}
        />

        <View style={styles.uploadSection}>
          <TouchableOpacity
            onPress={() => {
              setUploadOpen(!uploadOpen);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('export.uploadTitle')}
            accessibilityState={{ expanded: uploadOpen }}
            style={styles.uploadDisclosure}
          >
            <Text style={styles.uploadTitle}>{t('export.uploadTitle')}</Text>
            <Ionicons name={uploadOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {uploadOpen ? (
            <View style={styles.uploadFields}>
              <TextInput
                style={styles.urlInput}
                placeholder="https://example.com/upload"
                placeholderTextColor={colors.textSecondary}
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel={t('export.uploadTitle')}
                selectionColor={colors.primaryDark}
                editable={uploadState !== 'uploading'}
              />
              {uploadState === 'uploading' ? (
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${progress}%` }]} />
                </View>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.uploadBtn,
                  (!url.trim() || uploadState === 'uploading' || uploadState === 'done') && styles.uploadBtnDisabled,
                ]}
                onPress={() => {
                  upload(videoUri).catch(() => {});
                }}
                disabled={!url.trim() || uploadState === 'uploading' || uploadState === 'done'}
                accessibilityRole="button"
                accessibilityLabel={uploadLabel(uploadState, progress, t)}
              >
                {uploadState === 'uploading' ? <ActivityIndicator size="small" color={colors.onPrimary} /> : null}
                <Text style={styles.uploadBtnText}>{uploadLabel(uploadState, progress, t)}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  content: { paddingTop: spacing.s, gap: spacing.s },
  ready: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, marginBottom: spacing.m },
  readyCopy: { flex: 1, gap: spacing.xs },
  readyTitle: { ...typography.heading, color: colors.text, lineHeight: 26 },
  uploadDisclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    gap: spacing.s,
  },
  uploadFields: { gap: spacing.s },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.m,
    minHeight: 64,
    backgroundColor: withAlpha(colors.primary, 0.06),
    borderRadius: 12,
    padding: spacing.m,
  },
  actionRowDisabled: { opacity: 0.5 },
  actionRowText: { flex: 1 },
  actionLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  actionSublabel: { ...typography.caption, marginTop: 2, lineHeight: 20 },
  uploadSection: { gap: spacing.s, marginTop: spacing.s },
  uploadTitle: { ...typography.body, color: colors.text, flexShrink: 1, fontWeight: '600' },
  urlInput: {
    ...typography.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    paddingHorizontal: spacing.m,
    paddingVertical: 12,
    minHeight: 48,
    backgroundColor: colors.surface,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.divider,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primaryDark,
    borderRadius: 2,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    backgroundColor: colors.primaryDark,
    borderRadius: 12,
    paddingVertical: spacing.m,
  },
  uploadBtnDisabled: { opacity: 0.5 },
  uploadBtnText: { ...typography.button, color: colors.onPrimary },
});
