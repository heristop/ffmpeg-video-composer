// Noob on-ramp microcopy + collapsed-disclosure summary chips. All pure string helpers so they're
// unit-testable and reusable across the Add-section row and the section cards.
import type { TFunction } from 'i18next';
import type {
  AnimationOverlay,
  CaptureMode,
  EditorSection,
  FramingGuide,
  Grade,
  ImageOverlay,
  Letterbox,
  MotionEffect,
} from '../templateEditorModel';

const TITLE_CASE = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

export const SECTION_HINTS = {
  video: 'Record yourself on camera',
  form: 'Ask the viewer for text to overlay',
  partial: 'Reuse a saved scene fragment',
  color: 'Solid color card with a title',
  music: 'Background track for the whole video',
  image: 'A photo backdrop with motion',
} satisfies Record<EditorSection['kind'], string>;

// "Effects" group summary: the active look + motion move (Ken Burns by name, the rest generically)
// + the letterbox bars, or "None". `motion`/`letterbox` are optional so callers without them can omit.
export function effectsSummary(
  t: TFunction<'admin'>,
  look: string | undefined,
  motion?: MotionEffect[],
  letterbox?: Letterbox
): string {
  const parts: string[] = [];

  if (look) parts.push(TITLE_CASE(look));

  const kenburns = (motion ?? []).some((m) => m.type === 'kenburns');

  if (kenburns) parts.push(t('summaryChip.kenBurns'));

  const otherMotion = (motion ?? []).some((m) => m.type !== 'kenburns');

  if (otherMotion) parts.push(t('summaryChip.motion'));

  if (letterbox) parts.push(t('summaryChip.letterbox'));

  return parts.length > 0 ? parts.join(' · ') : t('summaryChip.none');
}

// "Animation" group summary: a single overlay's label (lost on re-hydrate from a saved descriptor,
// where it reads as a generic count), the layer count when several, or "None" when no overlay is set.
export function animationSummary(t: TFunction<'admin'>, animations: AnimationOverlay[] | undefined): string {
  const count = animations?.length ?? 0;

  if (count === 0) return t('summaryChip.none');

  if (count === 1) return animations?.[0]?.label ?? t('animationOverlay.count', { count });

  return t('animationOverlay.count', { count });
}

// Image-overlay summary: the layer count, or "None" when the section carries no images.
export function imageSummary(t: TFunction<'admin'>, images: ImageOverlay[] | undefined): string {
  const count = images?.length ?? 0;

  if (count === 0) return t('summaryChip.none');

  return t('imageOverlay.count', { count });
}

// Combined animations + images summary for the merged "Overlays" group: the total layer count across
// both kinds, or "None" when the section carries neither.
export function overlaysSummary(
  t: TFunction<'admin'>,
  animations: AnimationOverlay[] | undefined,
  images: ImageOverlay[] | undefined
): string {
  const count = (animations?.length ?? 0) + (images?.length ?? 0);

  if (count === 0) return t('summaryChip.none');

  return t('overlays.count', { count });
}

// Label for the active fade combination ('' when neither side fades).
function fadeLabel(t: TFunction<'admin'>, hasIn: boolean, hasOut: boolean): string {
  if (hasIn && hasOut) return t('summaryChip.fadeInOut');

  if (hasIn) return t('summaryChip.fadeIn');

  if (hasOut) return t('summaryChip.fadeOut');

  return '';
}

// "Audio" group summary: which fades are active + a volume override, or "Default".
export function audioSummary(
  t: TFunction<'admin'>,
  fade: { in?: unknown; out?: unknown } | undefined,
  hasVolumeOverride: boolean
): string {
  const parts: string[] = [];
  const fades = fadeLabel(t, Boolean(fade?.in), Boolean(fade?.out));

  if (fades) parts.push(fades);

  if (hasVolumeOverride) parts.push(t('summaryChip.customVolume'));

  return parts.length > 0 ? parts.join(' · ') : t('summaryChip.default');
}

// "Sound effects" group summary: the cue count, or "None".
export function sfxSummary(t: TFunction<'admin'>, cues: readonly unknown[] | undefined): string {
  const count = cues?.length ?? 0;

  if (count === 0) return t('summaryChip.none');

  return t('sfx.count', { count });
}

// "Camera guide" group summary: the silhouette position, or "Off".
export function framingSummary(t: TFunction<'admin'>, guide: FramingGuide | undefined): string {
  if (!guide) return t('summaryChip.off');

  return TITLE_CASE(guide.position);
}

// "Capture" group summary: the explicit default mode and/or the restricted mode count, or "Default"
// when the recorder keeps its stock behaviour (front camera, all four modes).
export function captureSummary(
  t: TFunction<'admin'>,
  captureMode: CaptureMode | undefined,
  allowedCaptureModes: CaptureMode[] | undefined
): string {
  const parts: string[] = [];

  if (captureMode) parts.push(t(`capture.mode.${captureMode}`));

  if (allowedCaptureModes && allowedCaptureModes.length > 0 && allowedCaptureModes.length < 4) {
    parts.push(t('capture.summaryModes', { count: allowedCaptureModes.length }));
  }

  return parts.length > 0 ? parts.join(' · ') : t('summaryChip.default');
}

// A grade counts toward the Effects summary's "edited" state too; exposed for callers that show a
// dot/marker when fine-tune values are non-default.
export const hasGrade = (grade: Grade | undefined): boolean => grade !== undefined;
