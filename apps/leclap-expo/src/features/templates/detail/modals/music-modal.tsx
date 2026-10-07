import { Image, Modal, ScrollView, View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Section } from '@/src/types';
import { colors } from '@/src/styles/theme';
import { MUSIC_LIBRARY, findMusic, musicCover } from '@/src/data/mediaCatalog';
import { PressableScale } from '@/src/components/kinetic/pressable-scale';
import { styles } from '@/src/features/templates/detail/detail.styles';

interface MusicSectionPickerProps {
  allowed: string[] | undefined;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

// Single-select track list. `allowed` (when set) restricts the library to the template's allowed ids.
function MusicSectionPicker({ allowed, selectedId, onSelect }: MusicSectionPickerProps) {
  const ids = allowed ?? MUSIC_LIBRARY.map((m) => m.id);

  return (
    <View>
      {ids.map((id) => {
        const track = findMusic(id);
        const selected = selectedId === id;
        const cover = musicCover(id);

        return (
          <PressableScale
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={track?.title ?? id}
            onPress={() => {
              onSelect(id);
            }}
            style={[styles.musicRow, selected && styles.musicRowActive]}
          >
            {cover ? (
              <Image source={cover} style={styles.musicRowCover} accessibilityIgnoresInvertColors />
            ) : (
              <Ionicons name="musical-note" size={18} color={selected ? colors.primary : colors.textSecondary} />
            )}
            <View style={styles.musicRowText}>
              <Text style={styles.musicRowTitle}>{track?.title ?? id}</Text>
              {track?.author ? <Text style={styles.musicRowAuthor}>{track.author}</Text> : null}
            </View>
            {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

interface MusicModalProps {
  section: Section | null;
  allowedMusic: string[] | undefined;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
  onUseDefault: () => void;
}

// Per-section music chooser. The viewer picks one allowed track (or the default soundtrack); the
// choice is stored as project.formData[`music_<name>`]. Allowed ids come from global.allowedMusic; an
// empty/absent list falls back to the whole library.
export function MusicModal({ section, allowedMusic, selectedId, onSelect, onClose, onUseDefault }: MusicModalProps) {
  const { t } = useTranslation('detail');

  if (!section) return null;

  const allowed = allowedMusic && allowedMusic.length > 0 ? allowedMusic : undefined;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.formModalContainer} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>{section.title?.en ?? section.name}</Text>
            <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel={t('music.done')}>
              <Ionicons name="close" size={26} color={colors.textStrong} />
            </PressableScale>
          </View>
          <ScrollView contentContainerStyle={styles.musicScroll}>
            <Text style={styles.musicHint}>{t('music.pick')}</Text>
            <PressableScale
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedId === 'default' }}
              onPress={() => {
                onSelect('default');
              }}
              style={[styles.musicRow, selectedId === 'default' && styles.musicRowActive]}
            >
              <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
              <Text style={styles.musicDefaultText}>{t('music.defaultOption')}</Text>
              {selectedId === 'default' ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
            </PressableScale>
            <MusicSectionPicker allowed={allowed} selectedId={selectedId} onSelect={onSelect} />
            <PressableScale style={styles.formSubmitButton} onPress={onUseDefault} haptic="medium">
              <Text style={styles.formSubmitButtonText}>{t('music.done')}</Text>
            </PressableScale>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

export default MusicModal;
