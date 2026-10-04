import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Modal,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer } from 'expo-video';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  MUSIC_LIBRARY,
  BACKGROUND_LIBRARY,
  backgroundAsset,
  musicAsset,
  type MediaCredit,
} from '@/src/data/mediaCatalog';
import { colors, spacing, typography, fonts, withAlpha } from '@/src/styles/theme';
import type { MediaChoice, MediaChoices } from '@/src/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserMediaPickerProps {
  /** Whether the modal is visible. */
  visible: boolean;
  /** Global options from the template descriptor. */
  allowedMusic?: string[];
  allowUploadMusic?: boolean;
  allowedBackgrounds?: string[];
  allowUploadBackground?: boolean;
  /** Current choices (controlled). */
  musicChoice: MediaChoice | null;
  backgroundChoice: MediaChoice | null;
  onMusicChange: (c: MediaChoice | null) => void;
  onBackgroundChange: (c: MediaChoice | null) => void;
  onClose: () => void;
}

// ─── Upload helpers ────────────────────────────────────────────────────────────

async function pickMusicFile(): Promise<MediaChoice | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    copyToCacheDirectory: true,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];

  return { kind: 'upload', uri: asset.uri, name: asset.name };
}

async function pickBackgroundImage(): Promise<MediaChoice | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsEditing: false,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'background.jpg';

  return { kind: 'upload', uri: asset.uri, name };
}

// ─── Allowed-list resolution ──────────────────────────────────────────────────

function resolveAllowedMusic(allowedIds: string[] | undefined): MediaCredit[] {
  if (!allowedIds?.length) return [];

  return allowedIds.flatMap((id) => {
    const entry = MUSIC_LIBRARY.find((m) => m.id === id);

    return entry ? [entry] : [];
  });
}

function resolveAllowedBackgrounds(allowedIds: string[] | undefined): MediaCredit[] {
  if (!allowedIds?.length) return [];

  return allowedIds.flatMap((id) => {
    const entry = BACKGROUND_LIBRARY.find((m) => m.id === id);

    return entry ? [entry] : [];
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// Each track gets a stable hue derived from its id, so the art tiles read as a varied set rather than a
// wall of identical gray squares. Returns a soft tint for the tile and a saturated tone for the glyph.
function trackHue(id: string): number {
  let h = 0;

  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + (id.codePointAt(i) ?? 0)) % 360;
  }

  return h;
}

// Three audio bars that breathe while a track previews — the "now playing" signal on the art tile.
// Animates scaleY only (native-driven), per the transform/opacity-only motion rule.
function Equalizer({ color }: { color: string }) {
  const bars = useRef([new Animated.Value(0.35), new Animated.Value(0.8), new Animated.Value(0.5)]).current;

  useEffect(() => {
    const loops = bars.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: 340 + i * 110,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.3,
            duration: 340 + i * 110,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      )
    );

    for (const loop of loops) {
      loop.start();
    }

    return () => {
      for (const loop of loops) {
        loop.stop();
      }
    };
  }, [bars]);

  return (
    <View style={st.equalizer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bars.map((value, i) => (
        <Animated.View key={i} style={[st.equalizerBar, { backgroundColor: color, transform: [{ scaleY: value }] }]} />
      ))}
    </View>
  );
}

interface MusicCardProps {
  item: MediaCredit;
  selected: boolean;
  previewing: boolean;
  onPress: () => void;
  onPreviewChange: (next: boolean) => void;
}

function MusicCard({ item, selected, previewing, onPress, onPreviewChange }: MusicCardProps) {
  // Bundled track module (a Metro asset id) — only locally-bundled tracks can be previewed on-device.
  const source = musicAsset(item.id);
  const player = useVideoPlayer(source ?? null, (p) => {
    p.loop = false;
    p.muted = false;
  });
  const hue = trackHue(item.id);
  const tileColor = `hsl(${hue}, 52%, 90%)`;
  const accentColor = `hsl(${hue}, 58%, 52%)`;

  // Drive the shared single-preview state: only the row that owns it plays. Restart from the top each
  // time so a re-tap previews from the beginning, matching the web picker.
  useEffect(() => {
    if (source === undefined) return;

    if (previewing) {
      player.currentTime = 0;
      player.play();

      return;
    }

    player.pause();
  }, [previewing, player, source]);

  // Release the shared slot when the track plays through to its end.
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      onPreviewChange(false);
    });

    return () => {
      sub.remove();
    };
  }, [player, onPreviewChange]);

  return (
    <View style={[st.trackRow, selected && st.trackRowSelected]}>
      {/* The art tile is the preview control; tapping it plays/pauses without changing selection. */}
      <TouchableOpacity
        onPress={() => {
          onPreviewChange(!previewing);
        }}
        disabled={source === undefined}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${previewing ? 'Pause' : 'Play'} preview of ${item.title}`}
        style={[st.trackArt, { backgroundColor: tileColor }, previewing && { borderColor: accentColor }]}
      >
        {previewing ? (
          <Equalizer color={accentColor} />
        ) : (
          <Ionicons
            name={source === undefined ? 'musical-notes' : 'play'}
            size={source === undefined ? 22 : 20}
            color={accentColor}
            style={source === undefined ? undefined : st.playGlyph}
          />
        )}
      </TouchableOpacity>

      {/* Tapping the body selects the track. */}
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${item.title} by ${item.author}`}
        style={st.trackBody}
      >
        <Text style={[st.trackTitle, selected && st.trackTitleSelected]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={st.trackAuthor} numberOfLines={1}>
          {item.author}
        </Text>
      </TouchableOpacity>

      {/* Visual + larger touch target for selection; the row body already carries the radio semantics. */}
      <TouchableOpacity
        onPress={onPress}
        hitSlop={8}
        importantForAccessibility="no-hide-descendants"
        style={[st.trackCheck, selected && st.trackCheckSelected]}
      >
        {selected && <Ionicons name="checkmark" size={16} color="#fff" />}
      </TouchableOpacity>
    </View>
  );
}

interface PictureCardProps {
  item: MediaCredit;
  selected: boolean;
  onPress: () => void;
}

function PictureCard({ item, selected, onPress }: PictureCardProps) {
  const source = backgroundAsset(item.id);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${item.title} by ${item.author}`}
      style={[st.card, selected && st.cardSelected]}
    >
      <View style={st.pictureThumb}>
        {source === undefined ? (
          <View style={[st.thumbImage, st.thumbPlaceholder]}>
            <Ionicons name="image-outline" size={24} color={colors.textSecondary} />
          </View>
        ) : (
          <Image source={source} style={st.thumbImage} resizeMode="cover" accessibilityIgnoresInvertColors />
        )}
        {selected && (
          <View style={st.checkBadge}>
            <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
          </View>
        )}
      </View>
      <Text style={st.cardTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={st.cardAuthor} numberOfLines={1}>
        {item.author}
      </Text>
    </TouchableOpacity>
  );
}

interface UploadRowProps {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  chosen: boolean;
  loading: boolean;
  onPress: () => void;
}

function UploadRow({ label, icon, chosen, loading, onPress }: UploadRowProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      style={[st.uploadRow, chosen && st.uploadRowSelected]}
    >
      <View style={st.uploadIcon}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name={icon} size={24} color={chosen ? colors.primary : colors.textSecondary} />
        )}
      </View>
      <Text style={[st.uploadLabel, chosen && st.uploadLabelSelected]}>{label}</Text>
      {chosen && <Ionicons name="checkmark-circle" size={22} color={colors.primary} style={st.uploadCheck} />}
    </TouchableOpacity>
  );
}

// ─── Music section ────────────────────────────────────────────────────────────

interface MusicSectionProps {
  allowedIds?: string[];
  allowUpload?: boolean;
  choice: MediaChoice | null;
  onChange: (c: MediaChoice | null) => void;
}

function MusicSection({ allowedIds, allowUpload, choice, onChange }: MusicSectionProps) {
  const [uploading, setUploading] = useState(false);
  // Only one track previews at a time across the section; null means nothing is playing.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const items = resolveAllowedMusic(allowedIds);

  const handleUpload = async () => {
    setUploading(true);

    try {
      const picked = await pickMusicFile();

      if (picked) onChange(picked);
    } finally {
      setUploading(false);
    }
  };

  const isUploadSelected = choice?.kind === 'upload';
  const uploadLabel = choice?.kind === 'upload' ? choice.name : 'Upload a track…';

  return (
    <View style={st.section}>
      <Text style={st.sectionLabel}>Music</Text>
      <Text style={st.sectionHint}>Tap the artwork to preview, the row to choose your soundtrack.</Text>
      {items.length > 0 && (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          ItemSeparatorComponent={() => <View style={st.trackSeparator} />}
          renderItem={({ item }) => (
            <MusicCard
              item={item}
              selected={choice?.kind === 'library' && choice.id === item.id}
              previewing={playingId === item.id}
              onPress={() => {
                onChange({ kind: 'library', id: item.id });
              }}
              onPreviewChange={(next) => {
                setPlayingId(next ? item.id : null);
              }}
            />
          )}
        />
      )}
      {allowUpload && (
        <UploadRow
          label={uploadLabel}
          icon="cloud-upload-outline"
          chosen={isUploadSelected}
          loading={uploading}
          onPress={() => {
            handleUpload().catch(() => {});
          }}
        />
      )}
    </View>
  );
}

// ─── Background section ───────────────────────────────────────────────────────

interface BackgroundSectionProps {
  allowedIds?: string[];
  allowUpload?: boolean;
  choice: MediaChoice | null;
  onChange: (c: MediaChoice | null) => void;
}

function BackgroundSection({ allowedIds, allowUpload, choice, onChange }: BackgroundSectionProps) {
  const [uploading, setUploading] = useState(false);
  const items = resolveAllowedBackgrounds(allowedIds);

  const handleUpload = async () => {
    setUploading(true);

    try {
      const picked = await pickBackgroundImage();

      if (picked) onChange(picked);
    } finally {
      setUploading(false);
    }
  };

  const isUploadSelected = choice?.kind === 'upload';
  const uploadLabel = choice?.kind === 'upload' ? choice.name : 'Upload a photo…';

  return (
    <View style={st.section}>
      <Text style={st.sectionLabel}>Background Image</Text>
      {items.length > 0 && (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={st.row}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <PictureCard
              item={item}
              selected={choice?.kind === 'library' && choice.id === item.id}
              onPress={() => {
                onChange({ kind: 'library', id: item.id });
              }}
            />
          )}
        />
      )}
      {allowUpload && (
        <UploadRow
          label={uploadLabel}
          icon="image-outline"
          chosen={isUploadSelected}
          loading={uploading}
          onPress={() => {
            handleUpload().catch(() => {});
          }}
        />
      )}
    </View>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function UserMediaPicker({
  visible,
  allowedMusic,
  allowUploadMusic,
  allowedBackgrounds,
  allowUploadBackground,
  musicChoice,
  backgroundChoice,
  onMusicChange,
  onBackgroundChange,
  onClose,
}: UserMediaPickerProps) {
  const showMusic = (allowedMusic?.length ?? 0) > 0 || Boolean(allowUploadMusic);
  const showBackground = (allowedBackgrounds?.length ?? 0) > 0 || Boolean(allowUploadBackground);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={st.container} edges={['top', 'bottom', 'left', 'right']}>
          <View style={st.header}>
            <Text style={st.title}>Music &amp; Background</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={[]}
            keyExtractor={() => ''}
            renderItem={null}
            ListHeaderComponent={
              <>
                {showMusic && (
                  <MusicSection
                    allowedIds={allowedMusic}
                    allowUpload={allowUploadMusic}
                    choice={musicChoice}
                    onChange={onMusicChange}
                  />
                )}
                {showBackground && (
                  <BackgroundSection
                    allowedIds={allowedBackgrounds}
                    allowUpload={allowUploadBackground}
                    choice={backgroundChoice}
                    onChange={onBackgroundChange}
                  />
                )}
              </>
            }
            contentContainerStyle={st.scrollContent}
          />

          <View style={st.footer}>
            <TouchableOpacity style={st.doneButton} onPress={onClose} accessibilityRole="button">
              <Text style={st.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const CARD_GAP = spacing.s;

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: { ...typography.title, flex: 1, marginRight: spacing.m },
  scrollContent: { padding: spacing.m, paddingBottom: spacing.xxl },
  section: { marginBottom: spacing.l },
  sectionLabel: {
    fontFamily: fonts.poppins.semiBold,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionHint: { ...typography.smallText, color: colors.textSecondary, marginBottom: spacing.m },
  row: { gap: CARD_GAP, marginBottom: CARD_GAP },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.divider,
    padding: spacing.s,
    overflow: 'hidden',
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(124,131,253,0.06)',
  },
  // ── Music playlist rows ──
  trackSeparator: { height: spacing.s },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.divider,
    paddingVertical: spacing.s,
    paddingLeft: spacing.s,
    paddingRight: spacing.m,
  },
  trackRowSelected: {
    borderColor: colors.primary,
    backgroundColor: withAlpha(colors.primary, 0.07),
  },
  trackArt: {
    width: 52,
    height: 52,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  playGlyph: { marginLeft: 2 },
  equalizer: { flexDirection: 'row', alignItems: 'center', height: 22, gap: 3 },
  equalizerBar: { width: 4, height: 22, borderRadius: 2 },
  trackBody: { flex: 1, marginLeft: spacing.m, marginRight: spacing.s },
  trackTitle: { fontFamily: fonts.inter.semiBold, fontSize: 15, fontWeight: '600', color: colors.text },
  trackTitleSelected: { color: colors.primaryDark },
  trackAuthor: { ...typography.smallText, color: colors.textSecondary, marginTop: 2 },
  trackCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackCheckSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pictureThumb: {
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: spacing.s,
    position: 'relative',
    backgroundColor: colors.background,
  },
  thumbImage: { width: '100%', height: '100%', borderRadius: 8 },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  checkBadge: { position: 'absolute', top: 4, right: 4, backgroundColor: colors.surface, borderRadius: 10 },
  cardTitle: { ...typography.caption, color: colors.text, fontWeight: '600', marginBottom: 2 },
  cardAuthor: { ...typography.smallText, color: colors.textSecondary },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.divider,
    borderStyle: 'dashed',
    padding: spacing.m,
    marginTop: spacing.s,
  },
  uploadRowSelected: { borderColor: colors.primary, borderStyle: 'solid' },
  uploadIcon: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  uploadLabel: { flex: 1, ...typography.body, color: colors.textSecondary, marginLeft: spacing.s },
  uploadLabelSelected: { color: colors.text },
  uploadCheck: { marginLeft: spacing.s },
  footer: {
    padding: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  doneButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.m,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  doneButtonText: {
    color: 'white',
    fontFamily: fonts.poppins.semiBold,
    fontSize: 17,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

export type { MediaChoices };
