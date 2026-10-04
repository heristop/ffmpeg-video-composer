import { useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type Tabs } from 'expo-router';
import { colors, spacing, typography, withAlpha } from '@/src/styles/theme';
import { motion } from '@/src/styles/motion';
import { PressableScale } from '@/src/components/kinetic/pressable-scale';
import { useMotionPreferences } from '@/src/hooks/use-motion-preferences';
import * as Haptics from 'expo-haptics';
import { useAdaptiveLayout } from '@/src/hooks/use-adaptive-layout';
import { NAVIGATION_RAIL_WIDTH } from '@/src/styles/adaptive-layout';

type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

export default function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { navigationRail } = useAdaptiveLayout();
  const rail = Platform.OS === 'android' && navigationRail;

  return (
    <SafeAreaView
      edges={rail ? ['bottom', 'left'] : ['bottom', 'left', 'right']}
      style={[styles.container, rail && styles.rail]}
    >
      <View style={[styles.tabBar, rail && styles.railTabs]}>
        {state.routes.map((route, index) => {
          const label = descriptors[route.key].options.title ?? route.name;
          const selected = state.index === index;
          const icons: Record<string, readonly [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
            index: ['film-outline', 'film'],
            'videos/index': ['videocam-outline', 'videocam'],
          };
          const icon = (icons[route.name] ?? icons.index)[selected ? 1 : 0];

          return (
            <TabItem
              key={route.key}
              label={label}
              icon={icon}
              selected={selected}
              rail={rail}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });

                if (!selected && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                  Haptics.selectionAsync().catch(() => {});
                }
              }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            />
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function TabItem({
  label,
  icon,
  selected,
  rail,
  onPress,
  onLongPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  rail: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { reducedMotion, appActive } = useMotionPreferences();
  const selection = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    selection.set(
      reducedMotion || !appActive
        ? Number(selected)
        : withTiming(Number(selected), { duration: motion.duration.instant, reduceMotion: ReduceMotion.Never })
    );

    return () => {
      cancelAnimation(selection);
    };
  }, [selected, reducedMotion, appActive, selection]);
  const badgeStyle = useAnimatedStyle(() => ({ opacity: selection.get() }));

  return (
    <PressableScale
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic={false}
      scaleTo={0.98}
      style={[styles.tabItem, rail && styles.railItem]}
    >
      <View style={styles.iconWrap}>
        <Animated.View pointerEvents="none" style={[styles.selected, badgeStyle]} />
        <Ionicons
          name={icon}
          size={24}
          color={selected ? colors.primaryDark : colors.textSecondary}
          accessible={false}
        />
      </View>
      <Text style={[styles.label, selected && styles.selectedText]}>{label}</Text>
    </PressableScale>
  );
}
const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  tabBar: { flexDirection: 'row', paddingVertical: spacing.s, minHeight: 68 },
  rail: {
    width: NAVIGATION_RAIL_WIDTH,
    borderTopWidth: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.divider,
  },
  railTabs: { flexDirection: 'column', gap: spacing.l, paddingTop: spacing.l },
  railItem: { flex: 0, minHeight: 72 },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    gap: spacing.xs,
    paddingHorizontal: spacing.s,
  },
  label: { ...typography.smallText, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  selectedText: { color: colors.primaryDark },
  iconWrap: { paddingHorizontal: spacing.l, paddingVertical: spacing.xs, borderRadius: 12 },
  selected: { ...StyleSheet.absoluteFill, borderRadius: 12, backgroundColor: withAlpha(colors.primary, 0.12) },
});
