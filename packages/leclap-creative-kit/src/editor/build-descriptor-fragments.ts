// Pure section-fragment builders shared by buildDescriptor: caption / overlay-input / visual-extras /
// audio / playback / fit lowering. Split out of build-descriptor so that module stays under the line
// budget. All helpers are file-local except the ones buildDescriptor composes back in.
import type { TemplateDescriptor, Section } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type {
  SectionTransition,
  Grade,
  Letterbox,
  MotionEffect,
  ChromaKey,
  EditorCaption,
  AnimationOverlay,
  ImageOverlay,
  MediaChoice,
  SectionFit,
  VisualAudio,
  FootageEdits,
  WatermarkChoice,
} from './model';
import { htmlInputsFrom, type HtmlLayer } from './html-layer';
import { motionBlocksOf, type MotionBlocks } from './motion-passthrough';
import { pruneEmpty } from './prune';

// Default authoring locale for Translation fields the editor emits (section descriptions,
// overlay/form text all key under 'en'). Single source so future i18n has one place to change.
export const DEFAULT_LOCALE = 'en';

// Common visual-section passthrough fields (transition + grading + motion), only emitted when set.
function captionDescriptorFrom(caption: EditorCaption | undefined): Section['caption'] | undefined {
  const text = caption?.text.trim();

  if (!caption || !text) return undefined;

  return pruneEmpty({
    text: { ...caption.textI18n, [DEFAULT_LOCALE]: text },
    position: caption.position,
    style: caption.style,
    align: caption.align,
    font: caption.font,
    fontsize: caption.fontsize,
    color: caption.color,
    box: caption.box,
    boxColor: caption.boxColor,
    boxOpacity: caption.boxOpacity,
    reveal: caption.reveal,
    effect: caption.effect,
    wrap: caption.wrap,
    fit: caption.fit,
  }) as Section['caption'];
}

// The playback extent — exactly one of duration / loops / loop (precedence duration > loops > loop).
// Emitting only the active one keeps the descriptor unambiguous and minimal.
function animationExtent(a: AnimationOverlay) {
  if (a.duration !== undefined) return { duration: a.duration };

  if (a.loops !== undefined) return { loops: a.loops };

  return { loop: a.loop ?? true };
}

// Placement/playback options shared by a section animation input and a whole-video global animation:
// extent (duration | loops | loop), persistent, start, position/scale; opacity only when it fades (< 1),
// rotation only when nonzero, flip/motion when set — so opaque/upright/static overlays stay clean.
function animationOptions(animation: AnimationOverlay) {
  return {
    ...animationExtent(animation),
    persistent: animation.persistent ?? true,
    ...(animation.start ? { start: animation.start } : {}),
    ...(animation.position ? { position: animation.position } : {}),
    ...(animation.scale ? { scale: animation.scale } : {}),
    // 'stretch' is the engine default, so only a real aspect choice (contain/cover) is written.
    ...(animation.fit && animation.fit !== 'stretch' ? { fit: animation.fit } : {}),
    ...(animation.opacity !== undefined && animation.opacity < 1 ? { opacity: animation.opacity } : {}),
    ...(animation.rotation ? { rotation: animation.rotation } : {}),
    ...(animation.flip ? { flip: animation.flip } : {}),
    ...(animation.motion ? { motion: animation.motion } : {}),
  };
}

// A looping animated overlay → a single `type: 'animation'` input the core auto-composites over the section.
function animationInputFrom(animation: AnimationOverlay, index: number): NonNullable<Section['inputs']>[number] {
  return { name: `animation_${index}`, url: animation.url, type: 'animation', options: animationOptions(animation) };
}

// A whole-video overlay → one global.animations entry (url + flattened options). Composited over the
// final joined video by the engine's AnimationComposer, spanning every section.
export function globalAnimationFrom(
  animation: AnimationOverlay
): NonNullable<NonNullable<TemplateDescriptor['global']>['animations']>[number] {
  return { url: animation.url, ...animationOptions(animation) };
}

// The author's animated overlays → `type: 'animation'` inputs named `animation_<i>` by array order.
// Entries without a url (a half-filled picker) are skipped.
function animationInputsFrom(animations: AnimationOverlay[] | undefined): NonNullable<Section['inputs']> {
  return (animations ?? []).filter((a) => a.url).map((a, i) => animationInputFrom(a, i));
}

// A MediaChoice → the marker url the descriptor carries: library → `library://<id>`, upload →
// `media://<key>` (materialized into the engine FS at compile), url → the pasted url as-is.
export function markerFromChoice(choice: MediaChoice): string {
  if (choice.source === 'library') return `library://${choice.id}`;

  if (choice.source === 'upload') return `media://${choice.key}`;

  return choice.url;
}

// The watermark's image → the descriptor's `global.watermark`, reusing the same marker vocabulary
// as an ImageOverlay's choice. Presentation fields pass through only when the author set them,
// leaving the engine defaults (bottom-right, 0.12, 0.8, 24) to apply. Emits nothing when unset.
export function watermarkField(
  watermark: WatermarkChoice | undefined
): Partial<NonNullable<TemplateDescriptor['global']>> {
  if (!watermark) return {};

  return {
    watermark: {
      url: markerFromChoice(watermark.image),
      ...(watermark.position ? { position: watermark.position } : {}),
      ...(watermark.scale === undefined ? {} : { scale: watermark.scale }),
      ...(watermark.opacity === undefined ? {} : { opacity: watermark.opacity }),
      ...(watermark.margin === undefined ? {} : { margin: watermark.margin }),
    },
  };
}

// Trim float noise off a seconds arithmetic result (0.3 - 0.1 → 0.2, not 0.19999999999999998).
function trimSeconds(value: number): number {
  return Number(value.toFixed(4));
}

// The editor's show window (start/end seconds) → the input's start/duration options. The engine
// lowers these to the overlay filter's timeline enable for images. start 0 and a non-positive
// window are omitted (untimed = spans the whole section), keeping the descriptor minimal.
function imageTimingFrom(overlay: ImageOverlay): { start?: number; duration?: number } {
  const start = overlay.start ?? 0;

  return {
    ...(start > 0 ? { start } : {}),
    ...(overlay.end !== undefined && overlay.end > start ? { duration: trimSeconds(overlay.end - start) } : {}),
  };
}

// A still-image overlay → a `type: 'image'` input composited via the same overlay path as animations.
// Named `image_<i>` by array position. position/scale/opacity(<1)/rotation(≠0)/flip/timing pass through when set.
// A builder-drawn shape carries its vector recipe (`shape`) on the input — editor metadata the engine
// ignores; the actual pixels are the choice's pre-rasterized PNG data: URL.
function imageInputFrom(overlay: ImageOverlay, index: number): NonNullable<Section['inputs']>[number] {
  const options = {
    ...(overlay.position ? { position: overlay.position } : {}),
    ...(overlay.scale ? { scale: overlay.scale } : {}),
    // 'stretch' is the engine default, so only a real aspect choice (contain/cover) is written.
    ...(overlay.fit && overlay.fit !== 'stretch' ? { fit: overlay.fit } : {}),
    ...(overlay.opacity !== undefined && overlay.opacity < 1 ? { opacity: overlay.opacity } : {}),
    ...(overlay.rotation ? { rotation: overlay.rotation } : {}),
    ...(overlay.flip ? { flip: overlay.flip } : {}),
    ...imageTimingFrom(overlay),
    ...(overlay.motion ? { motion: overlay.motion } : {}),
  };

  return {
    name: `image_${index}`,
    url: markerFromChoice(overlay.choice),
    type: 'image',
    ...(overlay.shape ? { shape: overlay.shape } : {}),
    options,
  };
}

// Animations, image overlays and HTML layers composited over a visual section, in z-order: animations
// first (array order), then images, then HTML layers on top. Spread AFTER visualExtras to override its animation-only
// `inputs`. Shared by video / color / image sections so each composites its overlays identically.
export function overlayInputsFrom(section: {
  animations?: AnimationOverlay[];
  images?: ImageOverlay[];
  htmlLayers?: HtmlLayer[];
}): NonNullable<Section['inputs']> {
  return [
    ...animationInputsFrom(section.animations),
    ...(section.images ?? []).map((image, i) => imageInputFrom(image, i)),
    ...htmlInputsFrom(section.htmlLayers),
  ];
}

export function visualExtras(
  section: {
    transitionAfter?: SectionTransition;
    caption?: EditorCaption;
    look?: string;
    grade?: Grade;
    letterbox?: Letterbox;
    motion?: MotionEffect[];
    chromaKey?: ChromaKey;
    animations?: AnimationOverlay[];
  } & MotionBlocks
): Partial<Section> {
  const caption = captionDescriptorFrom(section.caption);
  const animationInputs = animationInputsFrom(section.animations);

  return {
    ...(section.transitionAfter ? { transition: section.transitionAfter } : {}),
    ...(caption ? { caption } : {}),
    ...(section.look ? { look: section.look } : {}),
    ...(section.grade ? { grade: section.grade } : {}),
    ...(section.letterbox ? { letterbox: section.letterbox } : {}),
    ...(section.motion && section.motion.length > 0 ? { motion: section.motion } : {}),
    ...(section.chromaKey ? { chromaKey: section.chromaKey } : {}),
    ...(animationInputs.length > 0 ? { inputs: animationInputs } : {}),
    ...motionBlocksOf(section),
  };
}

// Per-section audio extras — only emitted when present; undefined values are dropped entirely.
export function sectionAudioOptions(section: VisualAudio): Partial<VisualAudio> {
  const out: Partial<VisualAudio> = {};

  if (section.musicVolume !== undefined) out.musicVolume = section.musicVolume;

  if (section.audioFade) out.audioFade = section.audioFade;

  if (section.audioEffect) out.audioEffect = section.audioEffect;

  if (section.voice) out.voice = section.voice;

  if (section.audioAutomation) out.audioAutomation = section.audioAutomation;

  return out;
}

// Per-section playback tempo (options.speed, a PTS multiplier — see model.VisualPlayback). Normal
// speed (1 / unset) emits nothing so untouched sections stay clean.
export function sectionPlaybackOptions(section: { speed?: number }): Partial<{ speed: number }> {
  if (section.speed === undefined || section.speed === 1) return {};

  return { speed: section.speed };
}

// The section's source-footage fit → the descriptor aspect flags SegmentBuilder lowers to
// scale/crop (cover) or scale/pad (letterbox), or `fit: 'blur'` (no legacy flag spells it). The
// default cover fit emits nothing; the footage pass-through (fill/focus/clip/ramp/freeze) rides along.
export function sectionFitOptions(section: {
  fit?: SectionFit;
  footage?: FootageEdits;
}): Partial<{ forceAspectRatio: boolean; forceOriginalAspectRatio: boolean; fit: 'blur' }> & FootageEdits {
  const footage: FootageEdits = pruneEmpty({ ...section.footage });

  if (section.fit === 'letterbox') return { forceOriginalAspectRatio: true, ...footage };

  if (section.fit === 'off') return { forceAspectRatio: false, ...footage };

  if (section.fit === 'blur') return { fit: 'blur', ...footage };

  return footage;
}
