import React, { useState, useEffect } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/src/styles/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmIconName?: IoniconName;
  confirmType?: 'danger' | 'success' | 'warning' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

function getButtonColor(confirmType: ConfirmDialogProps['confirmType']): string {
  switch (confirmType) {
    case 'danger':
      return colors.error;
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    default:
      return colors.primary;
  }
}

export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmIconName = 'checkmark',
  confirmType = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [showModal, setShowModal] = useState(visible);
  const [scaleAnim] = useState(() => new Animated.Value(0.9));
  const [opacityAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      return;
    }

    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 0.9,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShowModal(false);
    });
  }, [visible, scaleAnim, opacityAnim]);

  if (!visible && !showModal) return null;

  return (
    <Modal transparent visible={showModal} animationType="none" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.container,
            {
              opacity: opacityAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
          </View>

          <View style={styles.content}>
            <Text style={styles.message}>{message}</Text>
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onCancel} activeOpacity={0.7}>
              <Text style={styles.cancelText}>{cancelText}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.confirmButton, { backgroundColor: getButtonColor(confirmType) }]}
              onPress={onConfirm}
              activeOpacity={0.7}
            >
              <Ionicons name={confirmIconName} size={16} color="white" style={styles.icon} />
              <Text style={styles.confirmText}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: width * 0.85,
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  header: {
    padding: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: {
    ...typography.subtitle,
    textAlign: 'center',
    color: colors.text,
  },
  content: {
    padding: spacing.m,
    paddingTop: spacing.l,
    paddingBottom: spacing.l,
  },
  message: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textSecondary,
  },
  buttonContainer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  button: {
    flex: 1,
    paddingVertical: spacing.m,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  cancelButton: {
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.divider,
  },
  confirmButton: {
    backgroundColor: colors.error,
  },
  cancelText: {
    ...typography.button,
    color: colors.textSecondary,
  },
  confirmText: {
    ...typography.button,
    color: colors.surface,
  },
  icon: {
    marginRight: spacing.xs,
  },
});
