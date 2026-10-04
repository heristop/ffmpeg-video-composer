import { useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  TextInput,
  RefreshControl,
  Text,
  Pressable,
  useWindowDimensions,
  Platform,
} from 'react-native';
import type { Template } from '@/src/types';
import TemplateCard from './TemplateCard';
import { colors, spacing, typography } from '@/src/styles/theme';
import { Clappy } from '@/src/components/clappy/Clappy';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { filterTemplates, templateColumns } from '../template-presentation';
import { CONTENT_MAX_WIDTH } from '@/src/styles/adaptive-layout';

interface TemplateListProps {
  templates: Template[];
  onSelectTemplate: (template: Template) => void;
  isOffline?: boolean;
  onRefresh?: () => Promise<void> | void;
  screenTitle?: string;
  subtitle?: string;
  motionActive?: boolean;
}

export default function TemplateList({
  templates,
  onSelectTemplate,
  onRefresh,
  screenTitle,
  subtitle,
  motionActive = true,
}: TemplateListProps) {
  const { t, i18n } = useTranslation('templates');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [focused, setFocused] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const columns = templateColumns(Math.min(containerWidth || width, CONTENT_MAX_WIDTH), fontScale);
  const filtered = filterTemplates(templates, searchQuery, i18n.resolvedLanguage ?? i18n.language);
  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);

    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  // An element, rather than an inline component type, preserves input focus while filtering.
  const header = (
    <View style={styles.header}>
      <View style={styles.welcome}>
        <View style={styles.welcomeCopy}>
          {screenTitle ? (
            <Text accessibilityRole="header" style={styles.title}>
              {screenTitle}
            </Text>
          ) : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {fontScale < 1.3 ? <Clappy size={76} state={focused ? 'search' : 'welcome'} active={motionActive} /> : null}
      </View>
      <View style={[styles.search, focused && styles.searchFocused]}>
        <Ionicons name="search-outline" size={20} color={colors.textSecondary} accessible={false} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('search.placeholder')}
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={t('search.placeholder')}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          autoCorrect={false}
          returnKeyType="search"
          selectionColor={colors.primaryDark}
        />
        {searchQuery.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('search.clear')}
            onPress={() => {
              setSearchQuery('');
            }}
            style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
          >
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.results}>{t('search.count', { count: filtered.length })}</Text>
    </View>
  );

  return (
    <FlatList
      style={styles.container}
      onLayout={(event) => {
        setContainerWidth(event.nativeEvent.layout.width);
      }}
      key={columns}
      data={filtered}
      renderItem={({ item }) => (
        <View style={{ width: `${100 / columns}%`, padding: spacing.xs + 2 }}>
          <TemplateCard template={item} onPress={onSelectTemplate} />
        </View>
      )}
      keyExtractor={(item) => `${item.source ?? 'sample'}:${item.id ?? item.name}`}
      numColumns={columns}
      contentContainerStyle={[styles.list, { paddingBottom: Math.max(112, 64 * fontScale + 48) }]}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Clappy state="search" size={116} active={motionActive} />
          <Text accessibilityRole="header" style={styles.emptyTitle}>
            {t('search.emptyTitle')}
          </Text>
          <Text style={styles.emptyCopy}>{t('search.emptyBody')}</Text>
          {searchQuery ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSearchQuery('');
              }}
              style={({ pressed }) => [styles.reset, pressed && styles.pressed]}
            >
              <Text style={styles.resetText}>{t('search.clear')}</Text>
            </Pressable>
          ) : null}
        </View>
      }
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              handleRefresh().catch(() => {});
            }}
            tintColor={colors.primaryDark}
            colors={[colors.primaryDark]}
          />
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  list: { paddingHorizontal: spacing.m - 6, paddingBottom: 112 },
  header: { paddingHorizontal: 6, paddingTop: spacing.l, paddingBottom: spacing.s },
  welcome: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  welcomeCopy: { flex: 1, gap: spacing.s },
  title: { ...typography.displayM, color: colors.textStrong },
  subtitle: { ...typography.body, color: colors.textSecondary, lineHeight: 24 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    marginTop: spacing.l,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    paddingLeft: spacing.m,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  searchFocused: { borderColor: colors.primaryDark },
  searchInput: {
    ...typography.body,
    // The enclosing search control supplies the focus border.
    ...Platform.select({ web: { outlineStyle: 'solid', outlineWidth: 0 } }),
    color: colors.text,
    flex: 1,
    minHeight: 52,
    paddingVertical: 12,
    paddingRight: spacing.s,
  },
  clear: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  results: { ...typography.caption, marginTop: spacing.m, marginBottom: spacing.xs },
  empty: { alignItems: 'center', padding: spacing.l, paddingTop: spacing.xl, gap: spacing.m },
  emptyTitle: { ...typography.title, color: colors.text, textAlign: 'center' },
  emptyCopy: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24 },
  reset: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.m },
  resetText: { ...typography.body, color: colors.primaryDark, fontWeight: '600' },
});
