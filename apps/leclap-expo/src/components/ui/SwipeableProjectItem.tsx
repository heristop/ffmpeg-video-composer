import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/src/styles/theme';
import type { Project } from '@/src/types';
import ConfirmDialog from './dialog/ConfirmDialog';
import * as Haptics from 'expo-haptics';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface SwipeableProjectItemProps {
  project: Project;
  onPress: () => void;
  onDelete: () => Promise<void>;
}

const SWIPE_THRESHOLD = 80;

function getStatusColor(status: Project['status']): string {
  switch (status) {
    case 'completed':
      return colors.success;
    case 'processing':
      return colors.warning;
    default:
      return colors.primary;
  }
}

function getStatusIcon(status: Project['status']): IoniconName {
  switch (status) {
    case 'completed':
      return 'checkmark-circle';
    case 'processing':
      return 'time';
    default:
      return 'document-text';
  }
}

function getSubtitleText(status: Project['status']): string {
  if (status === 'completed') {
    return 'Ready to view';
  }

  if (status === 'processing') {
    return 'Processing...';
  }

  return 'Continue editing';
}

function useSwipePan() {
  const [pan] = useState(() => new Animated.ValueXY());
  const panXValue = useRef(0);
  const [panResponder, setPanResponder] = useState<ReturnType<typeof PanResponder.create> | null>(null);

  useEffect(() => {
    const listener = pan.x.addListener(({ value }) => {
      panXValue.current = value;
    });

    return () => {
      pan.x.removeListener(listener);
    };
  }, [pan]);

  useEffect(() => {
    const nextResponder = PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 5,
      onPanResponderGrant: () => {
        pan.setOffset({ x: panXValue.current, y: 0 });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x }], { useNativeDriver: true }),
      onPanResponderRelease: (_, gestureState) => {
        pan.flattenOffset();

        if (gestureState.dx < -SWIPE_THRESHOLD) {
          Animated.timing(pan, {
            toValue: { x: -SWIPE_THRESHOLD, y: 0 },
            duration: 200,
            useNativeDriver: true,
          }).start();

          return;
        }

        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          friction: 5,
          tension: 40,
          useNativeDriver: true,
        }).start();
      },
    });
    const timer = setTimeout(() => {
      setPanResponder(nextResponder);
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [pan]);

  const resetPan = () => {
    Animated.spring(pan, {
      toValue: { x: 0, y: 0 },
      friction: 5,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  const deleteButtonTranslateX = pan.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [0, SWIPE_THRESHOLD],
    extrapolate: 'clamp',
  });

  return { pan, panResponder, resetPan, deleteButtonTranslateX };
}

interface ProjectThumbnailProps {
  project: Project;
}

function ProjectThumbnail({ project }: ProjectThumbnailProps) {
  const statusColor = getStatusColor(project.status);
  const icon = getStatusIcon(project.status);

  if (project.thumbnailUri) {
    return <Image source={{ uri: project.thumbnailUri }} style={styles.thumbnail} />;
  }

  return (
    <View style={[styles.statusIcon, { backgroundColor: `${statusColor}20`, borderColor: statusColor }]}>
      <Ionicons name={icon} size={24} color={statusColor} />
    </View>
  );
}

interface ProjectActionsProps {
  onDeletePress: (e: { stopPropagation: () => void }) => void;
}

function ProjectActions({ onDeletePress }: ProjectActionsProps) {
  return (
    <View style={styles.actions}>
      <TouchableOpacity style={styles.actionButton} onPress={onDeletePress}>
        <Ionicons name="trash-outline" size={20} color={colors.error} />
      </TouchableOpacity>
      <View style={styles.chevron}>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </View>
    </View>
  );
}

interface SwipeDeleteButtonProps {
  deleteButtonTranslateX: Animated.AnimatedInterpolation<number>;
  onPress: () => void;
  isDeleting: boolean;
}

function SwipeDeleteButton({ deleteButtonTranslateX, onPress, isDeleting }: SwipeDeleteButtonProps) {
  return (
    <Animated.View style={[styles.deleteButton, { transform: [{ translateX: deleteButtonTranslateX }] }]}>
      <TouchableOpacity style={styles.deleteButtonTouchable} onPress={onPress} disabled={isDeleting}>
        {isDeleting ? (
          <ActivityIndicator size="small" color="white" />
        ) : (
          <>
            <Ionicons name="trash" size={24} color="white" />
            <Text style={styles.deleteText}>Delete</Text>
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const SwipeableProjectItem = React.memo(function SwipeableProjectItem({
  project,
  onPress,
  onDelete,
}: SwipeableProjectItemProps) {
  const [_isPressed, setIsPressed] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [scaleAnim] = useState(() => new Animated.Value(1));
  const { pan, panResponder, resetPan, deleteButtonTranslateX } = useSwipePan();

  const handlePressIn = () => {
    setIsPressed(true);
    Animated.spring(scaleAnim, { toValue: 0.98, friction: 8, tension: 40, useNativeDriver: true }).start();
  };

  const handlePressOut = () => {
    setIsPressed(false);
    Animated.spring(scaleAnim, { toValue: 1, friction: 5, tension: 40, useNativeDriver: true }).start();
  };

  const handleDeletePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setShowDialog(true);
  };

  const handleDeleteButtonPress = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    handleDeletePress();
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    setShowDialog(false);

    try {
      await onDelete();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error deleting project:', error);
      Alert.alert('Error', 'Failed to delete the project. Please try again.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsDeleting(false);
      resetPan();
    }
  };

  const handleConfirm = () => {
    confirmDelete().catch(() => {});
  };

  return (
    <View style={styles.container}>
      <SwipeDeleteButton
        deleteButtonTranslateX={deleteButtonTranslateX}
        onPress={handleDeletePress}
        isDeleting={isDeleting}
      />
      <Animated.View
        style={[styles.itemContainer, { transform: [{ translateX: pan.x }, { scale: scaleAnim }] }]}
        {...(panResponder?.panHandlers ?? {})}
      >
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onPress}
          style={styles.touchable}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <View style={styles.content}>
            <ProjectThumbnail project={project} />
            <View style={styles.textContainer}>
              <Text style={styles.title} numberOfLines={1}>
                {project.name}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {getSubtitleText(project.status)}
              </Text>
              <View style={styles.dateContainer}>
                <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.date}>{new Date(project.updatedAt).toLocaleDateString()}</Text>
              </View>
            </View>
            <ProjectActions onDeletePress={handleDeleteButtonPress} />
          </View>
        </TouchableOpacity>
      </Animated.View>
      <ConfirmDialog
        visible={showDialog}
        title="Delete Project"
        message={`Are you sure you want to delete "${project.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmIconName="trash"
        confirmType="danger"
        onConfirm={handleConfirm}
        onCancel={() => {
          setShowDialog(false);
        }}
      />
    </View>
  );
});

export default SwipeableProjectItem;

const styles = StyleSheet.create({
  container: { position: 'relative', overflow: 'hidden' },
  itemContainer: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    zIndex: 1,
    marginHorizontal: spacing.m,
    marginBottom: spacing.m,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: spacing.m,
    backgroundColor: colors.divider,
    resizeMode: 'cover',
  },
  touchable: { overflow: 'hidden', borderRadius: 12, backgroundColor: colors.surface },
  content: { flexDirection: 'row', alignItems: 'center', padding: spacing.m },
  statusIcon: {
    width: 60,
    height: 60,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.m,
    borderWidth: 1.5,
  },
  textContainer: { flex: 1, justifyContent: 'center' },
  title: { ...typography.subtitle, fontSize: 16 },
  subtitle: { ...typography.caption, marginTop: 2 },
  dateContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  date: { ...typography.smallText, color: colors.textSecondary, marginLeft: 4 },
  chevron: { marginLeft: spacing.s },
  actions: { flexDirection: 'row', alignItems: 'center' },
  actionButton: { padding: spacing.s, marginHorizontal: spacing.xs },
  deleteButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: SWIPE_THRESHOLD,
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  deleteButtonTouchable: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  deleteText: { ...typography.button, color: colors.surface, marginTop: 4, fontSize: 12 },
});
