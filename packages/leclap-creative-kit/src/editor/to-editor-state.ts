// Re-hydration: best-effort convert a stored TemplateDescriptor back to an EditorState.
import type { TemplateDescriptor, Section, PartialSection } from 'ffmpeg-video-composer/src/core/types.d.ts';
import {
  DEFAULT_AUDIO_MIX,
  DEFAULT_TRANSITION,
  newSection,
  makeTemplateId,
  type EditorSection,
  type EditorState,
  type EditableTemplate,
  type SectionTransition,
  type Grade,
  type Letterbox,
  type MotionEffect,
  type BackgroundLayer,
  type FramingGuide,
  type EditorCaption,
  type AnimationOverlay,
  type TitleCard,
  type LowerThird,
  type GlobalTextOverlay,
  type ChromaKey,
  type CaptureMode,
  type SectionFit,
  type VisualAudio,
  type FootageEdits,
} from './model';
import { audioFrom, colorsListFrom, defaultTransitionFrom, globalVariablesFrom } from './to-editor-global';
import { editorMotionFrom, motionBlocksOf, type MotionBlocks } from './motion-passthrough';
import { editorFormatsFrom } from './formats-passthrough';
import { overlaysFromFilters, videoFilterStateFrom } from './overlay-parsing';
import { pruneEmpty } from './prune';
import { editorIdentityFrom } from './template-meta';
import { animationsFrom, choiceFromMarker, imagesFrom, overlayOptionsFrom, watermarkFrom } from './to-editor-overlay';

function formSectionFrom(s: Section): EditorSection {
  const fields = (s.options?.fields ?? []) as Array<{
    name: string;
    maxLength?: number;
    label?: Record<string, string>;
  }>;

  return {
    kind: 'form',
    fields: fields.map((f) => ({ name: f.name, label: f.label?.en ?? f.name, maxLength: f.maxLength ?? 40 })),
  };
}

type StoredDescriptorSection = NonNullable<TemplateDescriptor['sections']>[number];

function isPartialSection(s: StoredDescriptorSection): s is PartialSection {
  return s.type === 'partial';
}

function partialSectionFrom(s: PartialSection): EditorSection {
  return {
    kind: 'partial',
    ref: s.ref ?? '',
    variables: Object.entries(s.variables ?? {}).map(([name, value]) => ({ name, value })),
    ...(s.prefix ? { prefix: s.prefix } : {}),
  };
}

// Recover an editor caption from a stored section's `caption`, resolving its localized text.
function captionFrom(s: Section): EditorCaption | undefined {
  const caption = s.caption;
  const text = caption?.text.en ?? Object.values(caption?.text ?? {}).find(Boolean);

  if (!caption || !text) return undefined;

  return pruneEmpty({
    text,
    textI18n: caption.text,
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
  }) as EditorCaption;
}

type VisualExtras = MotionBlocks & {
  transitionAfter?: SectionTransition;
  caption?: EditorCaption;
  look?: string;
  grade?: Grade;
  letterbox?: Letterbox;
  motion?: MotionEffect[];
  animations?: AnimationOverlay[];
};

function visualExtrasFrom(s: Section): VisualExtras {
  const caption = captionFrom(s);
  const animations = animationsFrom(s);

  return {
    ...(s.transition ? { transitionAfter: s.transition } : {}),
    ...(caption ? { caption } : {}),
    // The editor picks looks by name; a { preset, strength } look opens as its preset.
    ...(s.look ? { look: typeof s.look === 'string' ? s.look : s.look.preset } : {}),
    ...(s.grade ? { grade: s.grade } : {}),
    ...(s.letterbox ? { letterbox: s.letterbox } : {}),
    ...(s.motion && s.motion.length > 0 ? { motion: s.motion } : {}),
    ...(animations.length > 0 ? { animations } : {}),
    ...motionBlocksOf(s),
  };
}

// Recover per-section audio extras (musicVolume / audioFade / audioEffect / voice / audioAutomation).
function sectionAudioExtrasFrom(s: Section): VisualAudio {
  const mv = s.options?.musicVolume;
  const af = s.options?.audioFade;
  const ae = s.options?.audioEffect;
  const { voice, audioAutomation } = s.options ?? {};

  return {
    ...(mv === undefined ? {} : { musicVolume: mv }),
    ...(af ? { audioFade: af } : {}),
    ...(ae ? { audioEffect: ae } : {}),
    ...(voice ? { voice } : {}),
    ...(audioAutomation ? { audioAutomation } : {}),
  };
}

// Recover per-section playback tempo (options.speed, a PTS multiplier); normal speed stays absent.
function sectionPlaybackFrom(s: Section): { speed?: number } {
  const speed = s.options?.speed;

  return speed === undefined || speed === 1 ? {} : { speed };
}

// Recover the source-footage fit: options.fit when set (the engine lets it override the flags), else
// the stored aspect flags — letterbox wins when both are set, matching the engine. Default cover stays
// absent so untouched sections import clean. The footage edits without controls (fill/focus/clip/
// speedRamp/rampAudio/freeze) ride along verbatim.
function footageFrom(options: Section['options']): { footage?: FootageEdits } {
  if (!options) return {};

  const footage: FootageEdits = pruneEmpty({
    fill: options.fill,
    focus: options.focus,
    clip: options.clip,
    speedRamp: options.speedRamp,
    rampAudio: options.rampAudio,
    freeze: options.freeze,
  });

  return Object.keys(footage).length > 0 ? { footage } : {};
}

function sectionFitFrom(s: Section): { fit?: SectionFit; footage?: FootageEdits } {
  const options = s.options;
  const carried = footageFrom(options);
  const fit = options?.fit;

  if (fit) return fit === 'cover' ? carried : { fit, ...carried };

  if (options?.forceOriginalAspectRatio) return { fit: 'letterbox', ...carried };

  if (options?.forceAspectRatio === false) return { fit: 'off', ...carried };

  return carried;
}

function colorSectionFrom(s: Section): EditorSection {
  const layers = (s.options?.layers ?? []) as BackgroundLayer[];
  const images = imagesFrom(s);

  return {
    kind: 'color',
    duration: s.options?.duration ?? 3,
    color: s.options?.backgroundColor ?? '#7C83FD',
    ...(layers.length > 0 ? { layers } : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(s.titleCard ? { titleCard: s.titleCard as TitleCard } : {}),
    overlays: overlaysFromFilters(s.filters),
    ...sectionAudioExtrasFrom(s),
    ...sectionPlaybackFrom(s),
    ...visualExtrasFrom(s),
  };
}

// Recover a section description: 'en' string, else first translation, else undefined.
function descriptionFrom(s: Section): string | undefined {
  if (!s.description) return undefined;

  return s.description.en ?? Object.values(s.description)[0];
}

// Video-only extras (framing guide + lower third + capture modes), absent when not stored.
function videoExtrasFrom(s: Section): {
  framingGuide?: FramingGuide;
  lowerThird?: LowerThird;
  chromaKey?: ChromaKey;
  captureMode?: CaptureMode;
  allowedCaptureModes?: CaptureMode[];
} {
  const framingGuide = s.options?.framingGuide;
  const captureMode = s.options?.captureMode as CaptureMode | undefined;
  const allowedCaptureModes = s.options?.allowedCaptureModes as CaptureMode[] | undefined;

  return {
    ...(framingGuide ? { framingGuide } : {}),
    ...(s.lowerThird ? { lowerThird: s.lowerThird as LowerThird } : {}),
    ...(s.chromaKey ? { chromaKey: s.chromaKey } : {}),
    ...(captureMode ? { captureMode } : {}),
    ...(allowedCaptureModes && allowedCaptureModes.length > 0 ? { allowedCaptureModes } : {}),
  };
}

function videoSectionFrom(s: Section): EditorSection {
  const description = descriptionFrom(s);
  const images = imagesFrom(s);

  return {
    kind: 'video',
    // A stored `type: 'video'` section carries its fixed clip source in options.videoUrl — hydrate
    // it back to a MediaChoice so the section re-opens (and re-builds) as an asset-backed clip
    // instead of silently converting into a camera scene.
    ...(s.options?.videoUrl ? { videoUrl: choiceFromMarker(s.options.videoUrl) } : {}),
    ...(images.length > 0 ? { images } : {}),
    duration: s.options?.duration ?? 8,
    mute: Boolean(s.options?.muteSection),
    ...videoFilterStateFrom(s.filters),
    ...(description ? { description } : {}),
    countdown: Boolean(s.options?.countdown),
    countdownSeconds: s.options?.countdownDuration ?? 4,
    // A stored countdown is an explicit author choice, so re-opening never re-syncs it to clip duration.
    countdownCustomized: true,
    ...videoExtrasFrom(s),
    ...sectionAudioExtrasFrom(s),
    ...sectionPlaybackFrom(s),
    ...sectionFitFrom(s),
    ...visualExtrasFrom(s),
  };
}

function storedSectionToEditor(
  s: Section,
  allowedBackgrounds: string[],
  allowUploadBackground: boolean
): EditorSection | null {
  if (s.type === 'form') return formSectionFrom(s);

  if (s.type === 'color_background') return colorSectionFrom(s);

  if (s.type === 'image_background') {
    const images = imagesFrom(s);

    return {
      kind: 'image',
      allowed: allowedBackgrounds,
      allowUpload: allowUploadBackground,
      duration: s.options?.duration ?? 4,
      ...(images.length > 0 ? { images } : {}),
      overlays: overlaysFromFilters(s.filters),
      ...sectionAudioExtrasFrom(s),
      ...sectionPlaybackFrom(s),
      ...sectionFitFrom(s),
      ...visualExtrasFrom(s),
    };
  }

  return videoSectionFrom(s);
}

function isRenderableSection(s: NonNullable<TemplateDescriptor['sections']>[number]): s is Section {
  return s.type !== 'partial' && typeof s.name === 'string';
}

// Recover whole-video overlays from global.animations, carrying only explicit non-default options back
// (loop/persistent default true; opacity defaults opaque; rotation defaults upright), like animationsFrom.
function globalAnimationsFrom(global: TemplateDescriptor['global']): AnimationOverlay[] {
  return (global?.animations ?? []).map((animation, index) => ({
    id: `global_animation_${index}`,
    url: animation.url,
    ...overlayOptionsFrom(animation),
  }));
}

// Recover whole-video text overlays (global.overlays) — stored in the descriptor shape, so they map back unchanged.
function globalOverlaysFrom(global: TemplateDescriptor['global']): GlobalTextOverlay[] {
  return (global?.overlays ?? []) as GlobalTextOverlay[];
}

// Music has no positional descriptor section — surface it at the top of the list.
function musicSectionsFrom(global: TemplateDescriptor['global']): EditorSection[] {
  const allowed = global?.allowedMusic ?? [];
  const allowUpload = Boolean(global?.allowUploadMusic);

  if (allowed.length === 0 && !allowUpload) return [];

  return [{ kind: 'music', allowed, allowUpload }];
}

function editorSectionsFrom(descriptor: TemplateDescriptor): EditorSection[] {
  const { global: g, sections: storedSections = [] } = descriptor;
  const allowedBackgrounds = g?.allowedBackgrounds ?? [];
  const allowUploadBackground = Boolean(g?.allowUploadBackground);

  const positional = storedSections
    .map((s) => {
      if (isPartialSection(s)) return partialSectionFrom(s);

      if (isRenderableSection(s)) return storedSectionToEditor(s, allowedBackgrounds, allowUploadBackground);

      return null;
    })
    .filter((s): s is EditorSection => s !== null);

  const sections = [...musicSectionsFrom(g), ...positional];

  return sections.length > 0 ? sections : [newSection('video')];
}

export function toEditorState(template: EditableTemplate | null): EditorState {
  if (!template) {
    return {
      id: makeTemplateId(),
      name: '',
      description: '',
      orientation: 'landscape',
      sections: [newSection('video')],
      globalVariables: [],
      audio: { ...DEFAULT_AUDIO_MIX },
      defaultTransition: { ...DEFAULT_TRANSITION },
      globalAnimations: [],
      globalOverlays: [],
    };
  }

  const global = template.descriptor.global;
  const colorsList = colorsListFrom(global);
  const watermark = watermarkFrom(global);

  return {
    id: template.id,
    ...editorIdentityFrom(template),
    ...(editorMotionFrom(template.descriptor.global) ? { motion: editorMotionFrom(template.descriptor.global) } : {}),
    ...(editorFormatsFrom(template.descriptor) ? { formats: editorFormatsFrom(template.descriptor) } : {}),
    orientation: template.orientation,
    sections: editorSectionsFrom(template.descriptor),
    globalVariables: globalVariablesFrom(global),
    audio: audioFrom(global),
    defaultTransition: defaultTransitionFrom(global),
    globalAnimations: globalAnimationsFrom(global),
    globalOverlays: globalOverlaysFrom(global),
    ...(watermark ? { watermark } : {}),
    ...(global?.look ? { globalLook: typeof global.look === 'string' ? global.look : global.look.preset } : {}),
    ...(global?.grade ? { globalGrade: global.grade } : {}),
    ...(colorsList.length > 0 ? { colorsList } : {}),
  };
}
