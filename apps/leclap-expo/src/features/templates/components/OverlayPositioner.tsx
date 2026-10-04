// Advanced text-overlay editor. A modal with an aspect-correct frame; drag the text to set its
// normalized x/y, a slider sets fontsize, swatches set colour, a switch toggles the background box.
// Edits one TextOverlay in the section's overlays[] array. Pinch-to-size is deferred in favour of
// the fontsize slider (an acceptable fallback per the brief); drag uses PanResponder (in-repo precedent).
import React, { useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  PanResponder,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, findFont } from '@leclap/creative-kit/fonts';
import { colors, spacing, typography } from '@/src/styles/theme';
import { Slider, Segmented } from './EditorControls';
import { newOverlay, type TextOverlay, type Orientation } from '../model/templateEditorModel';
import { ASPECT_RATIO } from '../orientationMeta';

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const TEXT_COLORS = ['#ffffff', '#1B1830', '#FFE45E', '#FF8AAE', '#7C83FD', '#3FB27F'];

interface OverlayPositionerProps {
  visible: boolean;
  overlay: TextOverlay | undefined;
  orientation: Orientation;
  /** Global variable names insertable as `{{ name }}` tokens into the overlay text. */
  variables: string[];
  t: TFunction<'editor'>;
  onClose: () => void;
  onChange: (overlay: TextOverlay) => void;
  onRemove: () => void;
}

export const OverlayPositioner = ({
  visible,
  overlay,
  orientation,
  variables,
  t,
  onClose,
  onChange,
  onRemove,
}: OverlayPositionerProps) => {
  const value = overlay ?? newOverlay();
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const frameRef = useRef({ width: 0, height: 0 });
  const aspect = ASPECT_RATIO[orientation];

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    frameRef.current = { width, height };
    setFrame({ width, height });
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (e) => {
        const { width, height } = frameRef.current;

        if (width <= 0 || height <= 0) return;

        onChange({
          ...value,
          x: Math.round(clamp01(e.nativeEvent.locationX / width) * 1000) / 1000,
          y: Math.round(clamp01(e.nativeEvent.locationY / height) * 1000) / 1000,
        });
      },
    })
  ).current;

  const previewSize = Math.max(10, (value.fontsize / 96) * Math.min(frame.width, frame.height) * 0.5);
  const left = clamp01(value.x) * frame.width;
  const top = clamp01(value.y) * frame.height;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} accessibilityLabel={t('header.close')} style={styles.iconBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{t('overlay.title')}</Text>
            <TouchableOpacity onPress={onRemove} accessibilityLabel={t('overlay.remove')} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={22} color={colors.error} />
            </TouchableOpacity>
          </View>

          <View style={styles.frameWrap}>
            <View style={[styles.frame, { aspectRatio: aspect }]} onLayout={onLayout} {...responder.panHandlers}>
              {frame.width > 0 ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.overlayChip,
                    value.box && { backgroundColor: hexWithAlpha(value.boxcolor, value.boxOpacity) },
                    { left: left - 1, top: top - 1, transform: [{ translateX: -0.5 }] },
                  ]}
                >
                  <Text
                    style={{
                      color: value.fontcolor,
                      fontSize: previewSize,
                      fontWeight: '700',
                      fontFamily: findFont(value.font)?.cssFamily,
                    }}
                    numberOfLines={1}
                  >
                    {value.text.trim() === '' ? t('overlay.sample') : value.text}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.hint}>{t('overlay.hint')}</Text>
          </View>

          <View style={styles.controls}>
            <TextInput
              style={styles.input}
              value={value.text}
              onChangeText={(text) => {
                onChange({ ...value, text });
              }}
              placeholder={t('overlay.placeholder', { token: '{{ firstname }}' })}
              placeholderTextColor={colors.textSecondary}
            />

            {variables.length > 0 ? (
              <View>
                <Text style={styles.controlLabel}>{t('overlay.insertVariable')}</Text>
                <View style={styles.varChips}>
                  {variables.map((name) => (
                    <TouchableOpacity
                      key={name}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('overlay.insertVariable')} ${name}`}
                      onPress={() => {
                        onChange({ ...value, text: `${value.text}{{ ${name} }}` });
                      }}
                      style={styles.varChip}
                    >
                      <Text style={styles.varChipText} numberOfLines={1}>
                        {name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            <Slider
              label={t('overlay.size')}
              value={value.fontsize}
              min={16}
              max={96}
              step={1}
              format={(v) => `${Math.round(v)}px`}
              onChange={(fontsize) => {
                onChange({ ...value, fontsize });
              }}
            />

            <Text style={styles.controlLabel}>{t('overlay.font')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fontRow}>
              {FONTS.map((font) => {
                const active = value.font === font.id;

                return (
                  <TouchableOpacity
                    key={font.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${t('overlay.font')} ${font.label}`}
                    onPress={() => {
                      onChange({ ...value, font: font.id });
                    }}
                    style={[styles.fontChip, active && styles.fontChipActive]}
                  >
                    <Text
                      style={[styles.fontChipText, active && styles.fontChipTextActive, { fontFamily: font.cssFamily }]}
                      numberOfLines={1}
                    >
                      {font.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.controlLabel}>{t('overlay.colour')}</Text>
            <View style={styles.swatchRow}>
              {TEXT_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: value.fontcolor === c }}
                  accessibilityLabel={`${t('overlay.colour')} ${c}`}
                  onPress={() => {
                    onChange({ ...value, fontcolor: c });
                  }}
                  style={[styles.swatch, { backgroundColor: c }, value.fontcolor === c && styles.swatchActive]}
                />
              ))}
            </View>

            <Segmented
              label={t('overlay.box')}
              value={value.box ? 'on' : 'off'}
              options={[
                { value: 'off', label: t('overlay.boxOff') },
                { value: 'on', label: t('overlay.boxOn') },
              ]}
              onChange={(v) => {
                onChange({ ...value, box: v === 'on' });
              }}
            />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
};

// '#RRGGBB' + 0..1 alpha -> '#RRGGBBAA' for the preview box tint.
function hexWithAlpha(hex: string, opacity: number): string {
  const a = Math.round(clamp01(opacity) * 255)
    .toString(16)
    .padStart(2, '0');

  return `${hex}${a}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerTitle: { ...typography.subtitle, color: colors.text },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  frameWrap: { padding: spacing.m, alignItems: 'center' },
  frame: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#2b2740',
    borderRadius: 16,
    overflow: 'hidden',
  },
  overlayChip: { position: 'absolute', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
  hint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.s },
  controls: { paddingHorizontal: spacing.m },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  controlLabel: {
    ...typography.smallText,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.m,
    marginBottom: spacing.xs,
  },
  swatchRow: { flexDirection: 'row', gap: spacing.s, flexWrap: 'wrap' },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: colors.divider },
  swatchActive: { borderColor: colors.text },
  varChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  varChip: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
  },
  varChipText: { ...typography.smallText, color: colors.primary },
  fontRow: { gap: spacing.xs, paddingVertical: 2 },
  fontChip: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    backgroundColor: colors.surface,
  },
  fontChipActive: { borderColor: colors.primary, backgroundColor: colors.background },
  fontChipText: { ...typography.body, color: colors.text },
  fontChipTextActive: { color: colors.primary },
});
