// Kind-specific "basics" for a scene card (duration, mute, title, colour, form fields, media) plus
// the small shared field primitives and styles. Split out of SceneCard to keep both files focused.
// Every edit goes up via onChange (patchSection) — this never mutates EditorState.
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, ScrollView, Image, StyleSheet } from 'react-native';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/src/styles/theme';
import { ANIMATION_LIBRARY, BACKGROUND_LIBRARY, backgroundAsset } from '@/src/data/mediaCatalog';
import { OVERLAY_FITS } from 'ffmpeg-video-composer/src/schemas/effects.schemas.ts';
import { MediaPicker } from './MediaPicker';
import { PartialFields } from './PartialFields';
import { SpeedField } from './speed-field';
import { Slider, Segmented } from './EditorControls';
import {
  makeTemplateId,
  ANIMATION_EFFECT_PRESETS,
  animationDefaultsForUrl,
  hasFlipAxis,
  toggleFlipAxis,
  type EditorSection,
  type AnimationOverlay,
  type ImageOverlay,
  type OverlayFit,
  type OverlayFlip,
  type FlipAxis,
  type Orientation,
} from '../model/templateEditorModel';

const toggleId = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

interface SceneBasicsProps {
  index: number;
  section: EditorSection;
  orientation: Orientation;
  t: TFunction<'editor'>;
  defaultCountdownSeconds: (duration: number) => number;
  onChange: (p: Partial<EditorSection>) => void;
  onEditOverlay: (overlayIndex: number) => void;
}

export const SceneBasics = ({
  index,
  section,
  orientation,
  t,
  defaultCountdownSeconds,
  onChange,
  onEditOverlay,
}: SceneBasicsProps) => {
  if (section.kind === 'video') {
    return (
      <View>
        <FieldRow label={t('section.duration')}>
          <NumberInput
            value={section.duration}
            onChange={(duration) => {
              if (section.countdown && !section.countdownCustomized) {
                onChange({ duration, countdownSeconds: defaultCountdownSeconds(duration) });

                return;
              }

              onChange({ duration });
            }}
          />
        </FieldRow>
        <Toggle
          label={t('section.mute')}
          value={section.mute}
          onChange={(mute) => {
            onChange({ mute });
          }}
        />
        <SpeedField
          speed={section.speed}
          t={t}
          onChange={(speed) => {
            onChange({ speed });
          }}
        />
        <FieldRow label={t('section.whatToFilm')}>
          <TextInput
            style={styles.inputSm}
            value={section.description ?? ''}
            onChangeText={(text) => {
              onChange({ description: text.trim() === '' ? undefined : text });
            }}
            placeholder={t('section.whatToFilmPlaceholder')}
            placeholderTextColor={colors.textSecondary}
          />
        </FieldRow>
        <Text style={styles.fieldLabel}>{t('section.textOverlays')}</Text>
        {section.overlays.map((o, oi) => (
          <TouchableOpacity
            key={oi}
            accessibilityRole="button"
            accessibilityLabel={t('section.editTitle')}
            testID={`section-${index}-overlay-${oi}`}
            onPress={() => {
              onEditOverlay(oi);
            }}
            style={styles.overlayBtn}
          >
            <Ionicons name="text-outline" size={16} color={colors.primary} />
            <Text style={styles.overlayBtnText} numberOfLines={1}>
              {o.text.trim() === '' ? t('overlay.sample') : o.text}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('section.addText')}
          testID={`section-${index}-overlay`}
          onPress={() => {
            onEditOverlay(section.overlays.length);
          }}
          style={styles.addInline}
        >
          <Ionicons name="add" size={14} color={colors.primary} />
          <Text style={styles.addInlineText}>{t('section.addText')}</Text>
        </TouchableOpacity>
        <Toggle
          label={t('section.countdownToggle')}
          testID={`section-${index}-countdown`}
          value={section.countdown}
          onChange={(countdown) => {
            if (countdown) {
              onChange({
                countdown,
                countdownSeconds: defaultCountdownSeconds(section.duration),
                countdownCustomized: false,
              });

              return;
            }

            onChange({ countdown });
          }}
        />
        {section.countdown ? (
          <FieldRow label={t('section.countdown')}>
            <NumberInput
              value={section.countdownSeconds}
              onChange={(countdownSeconds) => {
                onChange({ countdownSeconds, countdownCustomized: true });
              }}
            />
          </FieldRow>
        ) : null}
        <OverlaysField
          orientation={orientation}
          animations={section.animations}
          images={section.images}
          onChangeAnimations={(animations) => {
            onChange({ animations });
          }}
          onChangeImages={(images) => {
            onChange({ images });
          }}
          t={t}
        />
      </View>
    );
  }

  if (section.kind === 'color') {
    return (
      <View>
        <FieldRow label={t('section.duration')}>
          <NumberInput
            value={section.duration}
            onChange={(duration) => {
              onChange({ duration });
            }}
          />
        </FieldRow>
        <FieldRow label={t('color.label')}>
          <View style={styles.colorRow}>
            <View style={[styles.swatch, { backgroundColor: section.color }]} />
            <TextInput
              style={[styles.inputSm, { flex: 1 }]}
              value={section.color}
              autoCapitalize="none"
              onChangeText={(color) => {
                onChange({ color });
              }}
              placeholder={t('color.placeholder')}
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </FieldRow>
        <SpeedField
          speed={section.speed}
          t={t}
          onChange={(speed) => {
            onChange({ speed });
          }}
        />
        <AnimationFieldsList
          orientation={orientation}
          value={section.animations}
          onChange={(animations) => {
            onChange({ animations });
          }}
          t={t}
        />
      </View>
    );
  }

  if (section.kind === 'form') {
    return (
      <View>
        {section.fields.map((f, fi) => (
          <FieldRow key={fi} label={t('field.label', { n: fi + 1 })}>
            <View style={styles.colorRow}>
              <TextInput
                style={[styles.inputSm, { flex: 1 }]}
                value={f.label}
                onChangeText={(label) => {
                  onChange({ fields: section.fields.map((x, idx) => (idx === fi ? { ...x, label } : x)) });
                }}
                placeholder={t('field.placeholder')}
                placeholderTextColor={colors.textSecondary}
              />
              {section.fields.length > 1 ? (
                <IconBtn
                  icon="close"
                  tint={colors.error}
                  onPress={() => {
                    onChange({ fields: section.fields.filter((_, idx) => idx !== fi) });
                  }}
                />
              ) : null}
            </View>
          </FieldRow>
        ))}
        <TouchableOpacity
          onPress={() => {
            onChange({
              fields: [...section.fields, { name: `field_${section.fields.length + 1}`, label: '', maxLength: 40 }],
            });
          }}
          style={styles.addInline}
        >
          <Ionicons name="add" size={14} color={colors.primary} />
          <Text style={styles.addInlineText}>{t('field.add')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (section.kind === 'music') {
    return (
      <View>
        <Text style={styles.fieldLabel}>{t('music.pick')}</Text>
        <MediaPicker
          kind="music"
          selectedIds={section.allowed}
          onToggleId={(id) => {
            onChange({ allowed: toggleId(section.allowed, id) });
          }}
        />
        <Toggle
          label={t('music.allowUpload')}
          testID={`section-${index}-allow-upload`}
          value={section.allowUpload}
          onChange={(allowUpload) => {
            onChange({ allowUpload });
          }}
        />
      </View>
    );
  }

  // A partial inserts a reusable fragment (expanded at compile time): pick which one and override its
  // variables.
  if (section.kind === 'partial') {
    return <PartialFields refId={section.ref} variables={section.variables} t={t} onChange={onChange} />;
  }

  return (
    <View>
      <FieldRow label={t('section.duration')}>
        <NumberInput
          value={section.duration}
          onChange={(duration) => {
            onChange({ duration });
          }}
        />
      </FieldRow>
      <Text style={styles.fieldLabel}>{t('image.pick')}</Text>
      <MediaPicker
        kind="picture"
        selectedIds={section.allowed}
        onToggleId={(id) => {
          onChange({ allowed: toggleId(section.allowed, id) });
        }}
      />
      <Toggle
        label={t('image.allowUpload')}
        testID={`section-${index}-allow-upload`}
        value={section.allowUpload}
        onChange={(allowUpload) => {
          onChange({ allowUpload });
        }}
      />
      <SpeedField
        speed={section.speed}
        t={t}
        onChange={(speed) => {
          onChange({ speed });
        }}
      />
    </View>
  );
};

export const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View style={{ marginTop: spacing.s }}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
  </View>
);

export const Toggle = ({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) => (
  <View style={styles.rowBetween}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <Switch
      testID={testID}
      value={value}
      onValueChange={onChange}
      trackColor={{ true: colors.primary, false: colors.divider }}
      thumbColor="#fff"
    />
  </View>
);

export const NumberInput = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
  <TextInput
    style={styles.inputSm}
    value={String(value)}
    keyboardType="number-pad"
    onChangeText={(t) => {
      const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
      onChange(Number.isNaN(n) ? 0 : n);
    }}
  />
);

// A hex-colour field: a swatch preview + a free-text hex input. RN has no native colour picker, so
// (like the section-colour field above) authoring stays a plain hex string. Shared by the chromaKey /
// titleCard / lowerThird panels for every colour they carry (key colour, accent, band colour, …).
export const ColorField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) => (
  <FieldRow label={label}>
    <View style={styles.colorRow}>
      <View style={[styles.swatch, { backgroundColor: value }]} />
      <TextInput
        style={[styles.inputSm, { flex: 1 }]}
        value={value}
        autoCapitalize="none"
        onChangeText={onChange}
        placeholder="#000000"
        placeholderTextColor={colors.textSecondary}
      />
    </View>
  </FieldRow>
);

export const IconBtn = ({
  icon,
  onPress,
  disabled,
  tint,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
  testID?: string;
}) => (
  <TouchableOpacity testID={testID} disabled={disabled} onPress={onPress} style={styles.iconBtnSm}>
    <Ionicons name={icon} size={18} color={disabled ? colors.divider : (tint ?? colors.textSecondary)} />
  </TouchableOpacity>
);

const parsePair = (value: string | undefined): [string, string] => {
  const [a = '', b = ''] = (value ?? '').split(':');

  return [a, b];
};

const formatPair = (a: string, b: string): string | undefined =>
  a.trim() === '' && b.trim() === '' ? undefined : `${a.trim() || '0'}:${b.trim() || '0'}`;

// The merged "Overlays" control for a video section: a segmented toggle picks between authoring
// animation overlays and still-image overlays, then renders the matching list. Mirrors the web
// builder's single "Overlays" disclosure with an Animation⇄Image toggle. Image overlays on Expo are
// bundled-library only (offline/local-first). Defaults to whichever kind already has layers.
type OverlayKind = 'animation' | 'image';

export const OverlaysField = ({
  orientation,
  animations,
  images,
  onChangeAnimations,
  onChangeImages,
  t,
}: {
  orientation: Orientation;
  animations: AnimationOverlay[] | undefined;
  images: ImageOverlay[] | undefined;
  onChangeAnimations: (animations: AnimationOverlay[] | undefined) => void;
  onChangeImages: (images: ImageOverlay[] | undefined) => void;
  t: TFunction<'editor'>;
}) => {
  const [kind, setKind] = React.useState<OverlayKind>((images?.length ?? 0) > 0 ? 'image' : 'animation');

  return (
    <View style={{ marginTop: spacing.m }}>
      <Segmented<OverlayKind>
        label={t('overlays.kind')}
        value={kind}
        options={[
          { value: 'animation', label: t('overlays.animation'), icon: 'sparkles-outline' },
          { value: 'image', label: t('overlays.image'), icon: 'image-outline' },
        ]}
        onChange={setKind}
      />
      {kind === 'animation' ? (
        <AnimationFieldsList orientation={orientation} value={animations} onChange={onChangeAnimations} t={t} />
      ) : (
        <ImageFieldsList value={images} onChange={onChangeImages} t={t} />
      )}
    </View>
  );
};

// A list of animation overlays for a visual scene: each row is a full AnimationFields editor with a
// remove control, plus a trailing picker to append more. Mirrors the web AnimationOverlayField; writes
// section.animations.
export const AnimationFieldsList = ({
  orientation,
  value,
  onChange,
  t,
}: {
  orientation: Orientation;
  value: AnimationOverlay[] | undefined;
  onChange: (animations: AnimationOverlay[] | undefined) => void;
  t: TFunction<'editor'>;
}) => {
  const animations = value ?? [];

  const replaceAt = (index: number, next: AnimationOverlay) => {
    onChange(animations.map((animation, i) => (i === index ? next : animation)));
  };

  const removeAt = (index: number) => {
    const next = animations.filter((_, i) => i !== index);

    onChange(next.length > 0 ? next : undefined);
  };

  const add = (animation: AnimationOverlay) => {
    onChange([...animations, { ...animation, id: makeTemplateId() }]);
  };

  return (
    <View>
      <Text style={[styles.fieldLabel, { marginTop: spacing.m }]}>{t('animation.effects.label')}</Text>
      {ANIMATION_EFFECT_PRESETS.map((preset) => (
        <TouchableOpacity
          key={preset.id}
          accessibilityRole="button"
          accessibilityLabel={t(preset.nameKey)}
          testID={`animation-effect-${preset.id}`}
          style={styles.effectPreset}
          onPress={() => {
            const added = preset.build(orientation).map((animation) => ({ ...animation, id: makeTemplateId() }));
            onChange([...animations, ...added]);
          }}
        >
          <View style={styles.effectPresetHeading}>
            <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
            <Text style={styles.effectPresetTitle}>{t(preset.nameKey)}</Text>
            <Ionicons name="add" size={18} color={colors.primary} />
          </View>
          <Text style={styles.effectPresetDescription}>{t(preset.descriptionKey)}</Text>
        </TouchableOpacity>
      ))}
      {animations.map((animation, index) => (
        <View key={animation.id ?? `animation-${index}`} style={styles.animLayer}>
          <View style={styles.animLayerHead}>
            <Text style={styles.fieldLabel}>{t('animation.layer', { number: index + 1 })}</Text>
            <TouchableOpacity
              onPress={() => {
                removeAt(index);
              }}
              accessibilityLabel={t('animation.remove')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <AnimationFields
            value={animation}
            onChange={(next) => {
              if (!next) {
                removeAt(index);

                return;
              }

              replaceAt(index, { ...next, id: animation.id });
            }}
            t={t}
          />
        </View>
      ))}
      <Text style={[styles.fieldLabel, { marginTop: spacing.m }]}>{t('animation.add')}</Text>
      <AnimationFields
        value={undefined}
        onChange={(next) => {
          if (next) add(next);
        }}
        t={t}
      />
    </View>
  );
};

// Animation-overlay sub-section for a visual scene (video / colour): pick a bundled .apng, then tune
// loop / keep-last-frame and position / scale. Mirrors the web AnimationGallery; one overlay each.
// Shared numeric placement controls for an overlay (animation or image): position, scale, fit, opacity,
// rotation and mirror flip. AnimationFields stacks its picker + loop/keep-last-frame on top; ImageFields
// stacks its picture picker — both delegate the common controls here so the two panels stay identical.
// Labels use the generic `animation.*` keys so both panels read the same. Mirrors the web
// placementFields.tsx (OverlayPlacementValue) field-for-field.
type PlacementValue = {
  position?: string;
  scale?: string;
  fit?: OverlayFit;
  opacity?: number;
  rotation?: number;
  flip?: OverlayFlip;
};

const FIT_LABEL_KEY: Record<OverlayFit, string> = {
  stretch: 'animation.fitStretch',
  contain: 'animation.fitContain',
  cover: 'animation.fitCover',
};

const PlacementFields = ({
  value,
  onChange,
  t,
}: {
  value: PlacementValue;
  onChange: (patch: PlacementValue) => void;
  t: TFunction<'editor'>;
}) => (
  <>
    <PairRow
      label={t('animation.position')}
      value={value.position}
      aLabel="X"
      bLabel="Y"
      placeholder="0"
      onChange={(position) => {
        onChange({ position });
      }}
    />
    <PairRow
      label={t('animation.scale')}
      value={value.scale}
      aLabel="W"
      bLabel="H"
      placeholder="auto"
      onChange={(scale) => {
        // Clearing the scale also clears the fit — without a box the mode has nothing to act on
        // (mirrors web placementFields.tsx).
        onChange(scale ? { scale } : { scale: undefined, fit: undefined });
      }}
    />
    {/* Fit only acts on a fixed W:H box, so the control appears once a scale is set. 'stretch' is the
        engine default and is stored as undefined to keep the descriptor minimal. */}
    {value.scale ? (
      <Segmented<OverlayFit>
        label={t('animation.fit')}
        value={value.fit ?? 'stretch'}
        options={OVERLAY_FITS.map((fit) => ({ value: fit, label: t(FIT_LABEL_KEY[fit]) }))}
        onChange={(fit) => {
          onChange({ fit: fit === 'stretch' ? undefined : fit });
        }}
      />
    ) : null}
    <Slider
      label={t('animation.opacity')}
      value={value.opacity ?? 1}
      min={0}
      max={1}
      step={0.05}
      format={(v) => `${Math.round(v * 100)}%`}
      resetTo={1}
      onChange={(opacity) => {
        onChange({ opacity });
      }}
    />
    <Slider
      label={t('animation.rotation')}
      value={value.rotation ?? 0}
      min={-180}
      max={180}
      step={1}
      format={(v) => `${Math.round(v)}°`}
      resetTo={0}
      onChange={(rotation) => {
        onChange({ rotation });
      }}
    />
    <MirrorToggle
      flip={value.flip}
      t={t}
      onChange={(flip) => {
        onChange({ flip });
      }}
    />
  </>
);

// Mirror control: two independent axis toggles (both on = the descriptor's 'both') writing the single
// combined flip value. Checkbox semantics — unlike fit, the axes are not mutually exclusive. Mirrors
// the web placementFields.tsx MirrorToggle.
const MirrorToggle = ({
  flip,
  t,
  onChange,
}: {
  flip: OverlayFlip | undefined;
  t: TFunction<'editor'>;
  onChange: (flip: OverlayFlip | undefined) => void;
}) => {
  const axes: Array<{ axis: FlipAxis; label: string }> = [
    { axis: 'horizontal', label: t('animation.mirrorHorizontal') },
    { axis: 'vertical', label: t('animation.mirrorVertical') },
  ];

  return (
    <View style={{ marginTop: spacing.m }}>
      <Text style={styles.fieldLabel}>{t('animation.mirror')}</Text>
      <View style={styles.mirrorRow}>
        {axes.map(({ axis, label }) => {
          const active = hasFlipAxis(flip, axis);

          return (
            <TouchableOpacity
              key={axis}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
              onPress={() => {
                onChange(toggleFlipAxis(flip, axis));
              }}
              style={[styles.mirrorItem, active && styles.mirrorItemActive]}
            >
              <Text style={[styles.mirrorText, active && styles.mirrorTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

export const AnimationFields = ({
  value,
  onChange,
  t,
}: {
  value: AnimationOverlay | undefined;
  onChange: (animation?: AnimationOverlay) => void;
  t: TFunction<'editor'>;
}) => {
  const patch = (over: Partial<AnimationOverlay>) => {
    if (value) onChange({ ...value, ...over });
  };

  return (
    <View style={{ marginTop: spacing.m }}>
      <Text style={styles.fieldLabel}>{t('animation.label')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.animStrip}>
        <AnimCard
          label={t('animation.none')}
          active={!value}
          onPress={() => {
            onChange();
          }}
          icon="ban-outline"
        />
        {ANIMATION_LIBRARY.map((animation) => (
          <AnimCard
            key={animation.id}
            label={animation.label}
            active={value?.url === animation.url}
            onPress={() => {
              onChange({ ...animationDefaultsForUrl(animation.url), url: animation.url, label: animation.label });
            }}
            source={animation.module}
          />
        ))}
      </ScrollView>

      {value ? (
        <View>
          <AnimationPlaybackFields value={value} patch={patch} t={t} />
          <Toggle
            label={t('animation.keepLastFrame')}
            value={value.persistent ?? true}
            onChange={(persistent) => {
              patch({ persistent });
            }}
          />
          <PlacementFields value={value} onChange={patch} t={t} />
        </View>
      ) : null}
    </View>
  );
};

type PlaybackMode = 'forever' | 'loops' | 'seconds';

// Derive the active mode from which extent field is set; loop:false (play once) reads as a 1-loop count.
const playbackModeOf = (v: AnimationOverlay): PlaybackMode => {
  if (v.duration !== undefined) return 'seconds';

  if (v.loops !== undefined || v.loop === false) return 'loops';

  return 'forever';
};

// Playback extent + start offset. The 3-way control sets exactly one extent (clearing the others); a
// whole-second start delays the overlay (0 = from the beginning).
const AnimationPlaybackFields = ({
  value,
  patch,
  t,
}: {
  value: AnimationOverlay;
  patch: (over: Partial<AnimationOverlay>) => void;
  t: TFunction<'editor'>;
}) => {
  const mode = playbackModeOf(value);

  const setMode = (next: PlaybackMode) => {
    if (next === 'forever') patch({ loop: true, loops: undefined, duration: undefined });

    if (next === 'loops') patch({ loops: value.loops ?? 1, loop: undefined, duration: undefined });

    if (next === 'seconds') patch({ duration: value.duration ?? 3, loop: undefined, loops: undefined });
  };

  return (
    <View>
      <Segmented<PlaybackMode>
        label={t('animation.playback')}
        value={mode}
        options={[
          { value: 'forever', label: t('animation.forever') },
          { value: 'loops', label: t('animation.loopsTab') },
          { value: 'seconds', label: t('animation.secondsTab') },
        ]}
        onChange={setMode}
      />
      {mode === 'loops' ? (
        <FieldRow label={t('animation.loopsLabel')}>
          <NumberInput
            value={value.loops ?? 1}
            onChange={(n) => {
              patch({ loops: Math.max(1, n) });
            }}
          />
        </FieldRow>
      ) : null}
      {mode === 'seconds' ? (
        <FieldRow label={t('animation.secondsLabel')}>
          <NumberInput
            value={value.duration ?? 3}
            onChange={(n) => {
              patch({ duration: Math.max(1, n) });
            }}
          />
        </FieldRow>
      ) : null}
      <FieldRow label={t('animation.startLabel')}>
        <NumberInput
          value={value.start ?? 0}
          onChange={(n) => {
            patch({ start: n > 0 ? n : undefined });
          }}
        />
      </FieldRow>
    </View>
  );
};

const AnimCard = ({
  label,
  active,
  onPress,
  source,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  source?: number;
  icon?: keyof typeof Ionicons.glyphMap;
}) => (
  <TouchableOpacity onPress={onPress} style={[styles.animCard, active && styles.animCardActive]}>
    <View style={styles.animThumb}>
      {source ? (
        <Image source={source} style={styles.animThumbImg} resizeMode="contain" />
      ) : (
        <Ionicons name={icon ?? 'ban-outline'} size={18} color={colors.textSecondary} />
      )}
    </View>
    <Text style={[styles.animCardLabel, active && { color: colors.primary }]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

// A list of still-image overlays for a video scene: each row is a full ImageFields editor with a
// remove control, plus a trailing picker to append more. Mirrors AnimationFieldsList; writes
// section.images. Expo image overlays are bundled-library only — each emits a `library` MediaChoice.
export const ImageFieldsList = ({
  value,
  onChange,
  t,
}: {
  value: ImageOverlay[] | undefined;
  onChange: (images: ImageOverlay[] | undefined) => void;
  t: TFunction<'editor'>;
}) => {
  const images = value ?? [];

  const replaceAt = (index: number, next: ImageOverlay) => {
    onChange(images.map((image, i) => (i === index ? next : image)));
  };

  const removeAt = (index: number) => {
    const next = images.filter((_, i) => i !== index);

    onChange(next.length > 0 ? next : undefined);
  };

  const add = (image: ImageOverlay) => {
    onChange([...images, { ...image, id: makeTemplateId() }]);
  };

  return (
    <View>
      {images.map((image, index) => (
        <View key={image.id} style={styles.animLayer}>
          <View style={styles.animLayerHead}>
            <Text style={styles.fieldLabel}>{t('image.layer', { number: index + 1 })}</Text>
            <TouchableOpacity
              onPress={() => {
                removeAt(index);
              }}
              accessibilityLabel={t('image.remove')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ImageFields
            value={image}
            onChange={(next) => {
              if (!next) {
                removeAt(index);

                return;
              }

              replaceAt(index, { ...next, id: image.id });
            }}
            t={t}
          />
        </View>
      ))}
      <Text style={[styles.fieldLabel, { marginTop: spacing.m }]}>{t('image.add')}</Text>
      <ImageFields
        value={undefined}
        onChange={(next) => {
          if (next) add(next);
        }}
        t={t}
      />
    </View>
  );
};

// Still-image-overlay sub-section for a video scene: pick a bundled background by id, then tune
// position / scale with the same numeric PairRow inputs as animations. Emits a `library` MediaChoice
// so the descriptor carries a `library://<id>` marker (staged on-device before compile). One overlay
// each; the "None" card clears the layer.
export const ImageFields = ({
  value,
  onChange,
  t,
}: {
  value: ImageOverlay | undefined;
  onChange: (image: ImageOverlay | undefined) => void;
  t: TFunction<'editor'>;
}) => {
  const selectedId = value?.choice.source === 'library' ? value.choice.id : undefined;

  const patch = (over: Partial<ImageOverlay>) => {
    if (value) onChange({ ...value, ...over });
  };

  const clear = () => {
    const empty: ImageOverlay | undefined = undefined;
    onChange(empty);
  };

  return (
    <View style={{ marginTop: spacing.m }}>
      <Text style={styles.fieldLabel}>{t('image.label')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.animStrip}>
        <AnimCard label={t('image.none')} active={!value} onPress={clear} icon="ban-outline" />
        {BACKGROUND_LIBRARY.map((background) => (
          <PictureCard
            key={background.id}
            label={background.title}
            active={selectedId === background.id}
            onPress={() => {
              onChange({
                id: value?.id ?? makeTemplateId(),
                position: value?.position,
                scale: value?.scale,
                choice: { source: 'library', id: background.id },
              });
            }}
            source={backgroundAsset(background.id)}
          />
        ))}
      </ScrollView>

      {value ? (
        <View>
          <PlacementFields value={value} onChange={patch} t={t} />
        </View>
      ) : null}
    </View>
  );
};

const PictureCard = ({
  label,
  active,
  onPress,
  source,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  source: number | undefined;
}) => (
  <TouchableOpacity onPress={onPress} style={[styles.animCard, active && styles.animCardActive]}>
    <View style={styles.animThumb}>
      {source === undefined ? (
        <Ionicons name="image-outline" size={18} color={colors.textSecondary} />
      ) : (
        <Image source={source} style={styles.animThumbImg} resizeMode="cover" />
      )}
    </View>
    <Text style={[styles.animCardLabel, active && { color: colors.primary }]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const PairRow = ({
  label,
  value,
  aLabel,
  bLabel,
  placeholder,
  onChange,
}: {
  label: string;
  value: string | undefined;
  aLabel: string;
  bLabel: string;
  placeholder: string;
  onChange: (value: string | undefined) => void;
}) => {
  const [a, b] = parsePair(value);

  return (
    <View style={{ marginTop: spacing.s }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.animPairRow}>
        <PairInput
          prefix={aLabel}
          value={a}
          placeholder={placeholder}
          onChange={(v) => {
            onChange(formatPair(v, b));
          }}
        />
        <PairInput
          prefix={bLabel}
          value={b}
          placeholder={placeholder}
          onChange={(v) => {
            onChange(formatPair(a, v));
          }}
        />
      </View>
    </View>
  );
};

const PairInput = ({
  prefix,
  value,
  placeholder,
  onChange,
}: {
  prefix: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) => (
  <View style={styles.animPairInput}>
    <Text style={styles.animPairPrefix}>{prefix}</Text>
    <TextInput
      style={styles.animPairField}
      value={value}
      placeholder={placeholder}
      placeholderTextColor={colors.textSecondary}
      keyboardType="numbers-and-punctuation"
      onChangeText={(text) => {
        onChange(text.replace(/[^\d-]/g, ''));
      }}
    />
  </View>
);

export const sceneStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.m,
    marginTop: spacing.s,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, flex: 1 },
  numberBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,131,253,0.15)',
  },
  numberBadgeText: { color: colors.primary, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardTitleText: { ...typography.button, color: colors.text },
  cardActions: { flexDirection: 'row', alignItems: 'center' },
});

const styles = StyleSheet.create({
  iconBtnSm: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { ...typography.smallText, color: colors.textSecondary, marginBottom: spacing.xs, flexShrink: 1 },
  inputSm: {
    ...typography.body,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.s,
    paddingVertical: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.m,
    gap: spacing.s,
  },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  swatch: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: colors.divider },
  overlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    minHeight: 44,
    marginTop: spacing.s,
    paddingHorizontal: spacing.s,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.background,
  },
  overlayBtnText: { ...typography.caption, color: colors.text, flex: 1 },
  addInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: spacing.m,
    marginTop: spacing.s,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: 'rgba(124,131,253,0.08)',
  },
  addInlineText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  mirrorRow: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  mirrorItem: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingHorizontal: spacing.xs,
  },
  mirrorItemActive: { backgroundColor: colors.primary },
  mirrorText: { ...typography.caption, fontSize: 13, color: colors.textSecondary },
  mirrorTextActive: { color: '#fff', fontWeight: '600' },
  animStrip: { gap: spacing.s, paddingVertical: spacing.xs, paddingRight: spacing.s },
  effectPreset: {
    minHeight: 44,
    marginTop: spacing.s,
    padding: spacing.s,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  effectPresetHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  effectPresetTitle: { ...typography.caption, color: colors.text, fontWeight: '600', flex: 1 },
  effectPresetDescription: { ...typography.smallText, color: colors.textSecondary, marginTop: spacing.xs },
  animLayer: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.s,
    marginTop: spacing.s,
  },
  animLayerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  animCard: {
    width: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: 4,
  },
  animCardActive: { borderColor: colors.primary, backgroundColor: 'rgba(124,131,253,0.08)' },
  animThumb: {
    height: 54,
    borderRadius: 8,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  animThumbImg: { width: '100%', height: '100%' },
  animCardLabel: { ...typography.smallText, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
  animPairRow: { flexDirection: 'row', gap: spacing.s },
  animPairInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.s,
  },
  animPairPrefix: { ...typography.smallText, color: colors.textSecondary, fontWeight: '700' },
  animPairField: { ...typography.body, fontSize: 14, color: colors.text, flex: 1, paddingVertical: 8 },
});
