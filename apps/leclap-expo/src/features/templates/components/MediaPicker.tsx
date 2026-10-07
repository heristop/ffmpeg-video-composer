import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  MUSIC_LIBRARY,
  BACKGROUND_LIBRARY,
  backgroundAsset,
  musicCover,
  type MediaCredit,
} from '@/src/data/mediaCatalog';
import { colors, spacing, typography } from '@/src/styles/theme';

export interface MediaPickerProps {
  kind: 'music' | 'picture';
  selectedIds: string[];
  onToggleId: (id: string) => void;
}

export function MediaPicker({ kind, selectedIds, onToggleId }: MediaPickerProps) {
  const items = kind === 'music' ? MUSIC_LIBRARY : BACKGROUND_LIBRARY;

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        scrollEnabled={false}
        renderItem={({ item }) => {
          const selected = selectedIds.includes(item.id);
          const toggle = () => {
            onToggleId(item.id);
          };

          if (kind === 'music') {
            return <MusicCard item={item} selected={selected} onPress={toggle} />;
          }

          return <PictureCard item={item} selected={selected} onPress={toggle} />;
        }}
      />
    </View>
  );
}

interface CardBaseProps {
  item: MediaCredit;
  selected: boolean;
  onPress: () => void;
}

function MusicCard({ item, selected, onPress }: CardBaseProps) {
  const cover = musicCover(item.id);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${item.title} by ${item.author}`}
      style={[styles.card, selected && styles.cardSelected]}
    >
      <View style={styles.musicArt}>
        {cover ? (
          <Image source={cover} style={styles.thumbImage} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <Ionicons name="musical-notes" size={28} color={selected ? colors.primary : colors.textSecondary} />
        )}
        {selected && (
          <View style={styles.checkBadge}>
            <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
          </View>
        )}
      </View>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.cardAuthor} numberOfLines={1}>
        {item.author}
      </Text>
    </TouchableOpacity>
  );
}

function PictureCard({ item, selected, onPress }: CardBaseProps) {
  const source = backgroundAsset(item.id);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${item.title} by ${item.author}`}
      style={[styles.card, selected && styles.cardSelected]}
    >
      <View style={styles.pictureThumb}>
        {source === undefined ? (
          <View style={[styles.thumbImage, styles.thumbPlaceholder]}>
            <Ionicons name="image-outline" size={24} color={colors.textSecondary} />
          </View>
        ) : (
          <Image source={source} style={styles.thumbImage} resizeMode="cover" accessibilityIgnoresInvertColors />
        )}
        {selected && (
          <View style={styles.checkBadge}>
            <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
          </View>
        )}
      </View>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.cardAuthor} numberOfLines={1}>
        {item.author}
      </Text>
    </TouchableOpacity>
  );
}

const CARD_GAP = spacing.s;

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.s,
  },
  row: {
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
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
  // Music card art area
  musicArt: {
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.s,
    position: 'relative',
  },
  // Picture card thumbnail
  pictureThumb: {
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: spacing.s,
    position: 'relative',
    backgroundColor: colors.background,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  checkBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
  },
  cardTitle: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardAuthor: {
    ...typography.smallText,
    color: colors.textSecondary,
  },
});
