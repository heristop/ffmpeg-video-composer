import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { colors, spacing } from '@/src/styles/theme';
import { useMotionPreferences } from '@/src/hooks/use-motion-preferences';

interface SkeletonLoaderProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: object;
}

export function SkeletonLoader({ width = '100%', height = 20, borderRadius = 4, style }: SkeletonLoaderProps) {
  const [animatedValue] = useState(() => new Animated.Value(0));
  const { reducedMotion, appActive } = useMotionPreferences();

  useEffect(() => {
    if (reducedMotion || !appActive) {
      animatedValue.setValue(0.5);

      return () => {
        animatedValue.stopAnimation();
      };
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [animatedValue, reducedMotion, appActive]);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
}

interface TemplateCardSkeletonProps {
  style?: object;
}

export function TemplateCardSkeleton({ style }: TemplateCardSkeletonProps) {
  return (
    <View style={[styles.templateCard, style]}>
      <SkeletonLoader width="100%" height={120} borderRadius={12} style={styles.templateImage} />

      <View style={styles.templateContent}>
        <SkeletonLoader width="80%" height={20} style={{ marginBottom: spacing.s }} />
        <SkeletonLoader width="100%" height={16} style={{ marginBottom: spacing.xs }} />
        <SkeletonLoader width="60%" height={14} />
      </View>
    </View>
  );
}

interface TemplateListSkeletonProps {
  count?: number;
}

export function TemplateListSkeleton({ count = 6 }: TemplateListSkeletonProps) {
  return (
    <View style={styles.templateList}>
      {Array.from({ length: count }, (_, index) => (
        <TemplateCardSkeleton key={index} style={{ marginBottom: spacing.m }} />
      ))}
    </View>
  );
}

export function TemplateDetailSkeleton() {
  return (
    <View style={styles.templateDetail}>
      {/* Header */}
      <View style={styles.detailHeader}>
        <SkeletonLoader width={24} height={24} borderRadius={12} />
        <SkeletonLoader width="70%" height={24} style={{ marginLeft: spacing.m }} />
      </View>

      {/* Orientation and description */}
      <View style={styles.detailInfo}>
        <SkeletonLoader width={120} height={16} style={{ marginBottom: spacing.s }} />
        <SkeletonLoader width="100%" height={16} style={{ marginBottom: spacing.xs }} />
        <SkeletonLoader width="80%" height={16} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressSection}>
        <SkeletonLoader width="100%" height={8} borderRadius={4} style={{ marginBottom: spacing.s }} />
        <SkeletonLoader width="40%" height={14} />
      </View>

      {/* Sections */}
      <SkeletonLoader width="30%" height={18} style={{ marginVertical: spacing.m }} />

      {Array.from({ length: 4 }, (_, index) => (
        <View key={index} style={styles.sectionItem}>
          <View style={styles.sectionIcon}>
            <SkeletonLoader width={24} height={24} borderRadius={12} />
          </View>
          <View style={styles.sectionText}>
            <SkeletonLoader width="60%" height={16} style={{ marginBottom: spacing.xs }} />
            <SkeletonLoader width="90%" height={14} />
          </View>
          <SkeletonLoader width={24} height={24} borderRadius={12} />
        </View>
      ))}

      {/* Footer button */}
      <View style={styles.footerButton}>
        <SkeletonLoader width="100%" height={56} borderRadius={12} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.divider,
  },
  templateCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  templateImage: {
    marginBottom: spacing.m,
  },
  templateContent: {
    padding: spacing.m,
  },
  templateList: {
    padding: spacing.m,
  },
  templateDetail: {
    flex: 1,
    padding: spacing.m,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.l,
    paddingBottom: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  detailInfo: {
    marginBottom: spacing.l,
  },
  progressSection: {
    marginBottom: spacing.l,
  },
  sectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.m,
    marginBottom: spacing.m,
  },
  sectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.m,
  },
  sectionText: {
    flex: 1,
  },
  footerButton: {
    position: 'absolute',
    bottom: spacing.m,
    left: spacing.m,
    right: spacing.m,
  },
});

// Default export (use TemplateListSkeleton as the main component)
export default TemplateListSkeleton;
