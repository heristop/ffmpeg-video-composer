// Types, interfaces, constants, and section factories for the template editor model.
// Consumed by buildDescriptor, operations, and toEditorState — pure, no React/DOM/RN dep.
import type { z } from 'zod';
import type { TemplateDescriptor, Letterbox } from 'ffmpeg-video-composer/src/core/types.d.ts';

// Re-export the core descriptor type so both apps can pin their stored-template shapes to the
// exact descriptor buildDescriptor emits / toEditorState consumes — keeping the editor in lock-step.
export type { TemplateDescriptor, Letterbox } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type {
  GradeSchema,
  MotionEffectSchema,
  BackgroundLayerSchema,
  FramingGuideSchema,
  OverlayFitSchema,
  OverlayFlipSchema,
  RevealSchema,
  ExitSchema,
  TextEffectSchema,
  ChromaKeySchema,
  DuckingSchema,
} from 'ffmpeg-video-composer/src/schemas/effects.schemas.ts';
import type { TimedRevealSchema, TimedExitSchema } from 'ffmpeg-video-composer/src/schemas/reveal.schemas.ts';
// CaptureModeSchema is a value import (not type-only): ALL_CAPTURE_MODES reads .options off it at
// runtime, so it can't join the `import type` group above it.
import {
  type CaptionSchema,
  type TitleCardSchema,
  type LowerThirdSchema,
  type ShapeSpecSchema,
  CaptureModeSchema,
} from 'ffmpeg-video-composer/src/schemas/section.schemas.ts';
import type {
  AudioMixPassthrough,
  EditorFormats,
  EditorMeta,
  EditorMotion,
  FootageEdits,
  MotionBlocks,
} from './motion-passthrough';
import type { DefaultTransition, SectionTransition } from './transition-types';
export { DEFAULT_TRANSITION, type DefaultTransition, type SectionTransition } from './transition-types';
export type { EditorMotion, FootageEdits, MotionBlocks } from './motion-passthrough';
import type { VisualAudio } from './visual-audio';
export type { AudioEffect, AudioFadeSide, SectionAudioFade, VisualAudio } from './visual-audio';
import type {
  Orientation,
  GlobalTextOverlaySchema,
  WatermarkSchema,
} from 'ffmpeg-video-composer/src/schemas/global.schemas.ts';
import type { AccentBar } from './accent-bar';
import type { VideoFilterFields, VideoOverlaySlot } from './video-filter-types';
import { DEFAULT_FONT_ID, findFontByFile, type FontInput } from '../fonts';

export type MediaChoice =
  | { source: 'library'; id: string }
  | { source: 'upload'; key: string; label: string }
  | { source: 'url'; url: string };

// Builder feature types, inferred from the core zod schemas so they can never drift.
export type Grade = z.infer<typeof GradeSchema>;
export type MotionEffect = z.infer<typeof MotionEffectSchema>;
export type BackgroundLayer = z.infer<typeof BackgroundLayerSchema>;
export type FramingGuide = z.infer<typeof FramingGuideSchema>;
export type DescriptorCaption = z.infer<typeof CaptionSchema>;
export type CaptionPosition = NonNullable<DescriptorCaption['position']>;
export type CaptionStyle = NonNullable<DescriptorCaption['style']>;
export type CaptionAlign = NonNullable<DescriptorCaption['align']>;
// Text-sugar feature types, inferred from the core schemas so the editor stores the exact descriptor
// shape and build/import is a pass-through (the same approach as Grade/MotionEffect above).
export type Reveal = z.infer<typeof RevealSchema>;
export type Exit = z.infer<typeof ExitSchema>;
// Drawtext overlays also accept time references ("title.end + 0.2") in reveal.delay / exit.after.
export type OverlayReveal = z.infer<typeof TimedRevealSchema>;
export type OverlayExit = z.infer<typeof TimedExitSchema>;
export type TextEffect = z.infer<typeof TextEffectSchema>;
export type ChromaKey = z.infer<typeof ChromaKeySchema>;
// How an overlay maps into its "w:h" scale box: stretch (default, may distort) / contain / cover.
export type OverlayFit = z.infer<typeof OverlayFitSchema>;
// Mirror applied to the overlay before rotation/compositing: horizontal / vertical / both.
export type OverlayFlip = z.infer<typeof OverlayFlipSchema>;
export type DuckingSettings = z.infer<typeof DuckingSchema>;
export type TitleCard = z.infer<typeof TitleCardSchema>;
export type LowerThird = z.infer<typeof LowerThirdSchema>;
// The vector recipe of a builder-drawn shape element (rect/ellipse). Stored on an ImageOverlay whose
// choice url is the pre-rasterized PNG data: URL; the descriptor carries it verbatim (engine ignores
// it) so the shape controls re-hydrate on import.
export type ShapeSpec = z.infer<typeof ShapeSpecSchema>;
export type GlobalTextOverlay = z.infer<typeof GlobalTextOverlaySchema>;
// The watermark's corner enum, inferred so it can never drift from the engine schema (global.watermark).
// The editor's own WatermarkChoice (below) swaps the descriptor's plain `url` string for a MediaChoice.
export type WatermarkPosition = NonNullable<z.infer<typeof WatermarkSchema>['position']>;
// Recorder input source for a project_video section: front/back camera, screen share, or file upload.
// Pure recorder metadata (honoured by both capture UIs), never lowered to FFmpeg filters.
export type CaptureMode = z.infer<typeof CaptureModeSchema>;

// Every capture mode, in display order — the recorder default when a template doesn't restrict them.
export const ALL_CAPTURE_MODES: readonly CaptureMode[] = CaptureModeSchema.options;

// How a section's SOURCE footage maps into the output frame (descriptor options.forceAspectRatio /
// forceOriginalAspectRatio / fit, lowered by the engine's reframe step — scale/crop/pad, LGPL-safe).
// 'cover' (default, omitted) fills the frame and crops the overflow; 'letterbox' keeps the whole frame
// visible with pad bars (forceOriginalAspectRatio: true); 'blur' keeps the whole frame over a blurred,
// dimmed copy of itself (options.fit: 'blur'); 'off' skips the conform scaling entirely
// (forceAspectRatio: false) for sources that already match the output.
export type SectionFit = 'cover' | 'letterbox' | 'blur' | 'off';

// Every fit mode, in display order — shared by the builder UIs' segmented control.
export const SECTION_FIT_MODES: readonly SectionFit[] = ['cover', 'letterbox', 'blur', 'off'];

// --- Editor-friendly section model (flattened; compiled to a descriptor on save) ---
export type FormField = { name: string; label: string; maxLength: number };

// A single positionable text overlay on a video section. x/y are [0,1] fractions
// of the frame; fontcolor/boxcolor are hex strings like '#ffffff'. boxOpacity is
// the background box alpha in [0,1].
export interface TextOverlay extends VideoOverlaySlot {
  text: string;
  x: number;
  y: number;
  fontsize: number;
  fontcolor: string;
  font: string;
  box: boolean;
  boxcolor: string;
  boxOpacity: number;
  // Background-box padding in video px around the text (drawtext boxborderw); omitted = the
  // historical 12. drawtext/drawbox have no corner radius (LGPL or otherwise), so padding is the
  // only box-shape knob the engine can honour.
  boxPadding?: number;
  // Whole-text alpha in [0,1] for watermark-style overlays; omitted = fully opaque. Lowered as a
  // `#rrggbb@a` fontcolor token (the pattern boxcolor already uses) rather than the drawtext `alpha`
  // option, which FilterManager.bakeTextAnimation overwrites with the reveal/exit expression.
  textOpacity?: number;
  // Animated entrance (rise/slide/fade); the engine bakes it onto the drawtext at compile.
  reveal?: OverlayReveal;
  // Animated exit (rise/slide/fade out) after a delay, timed against the section duration; the engine
  // bakes it alongside the entrance at compile.
  exit?: OverlayExit;
  // Drop shadow / outline for legibility over busy footage; lowered to drawtext
  // shadowx/shadowy/shadowcolor + borderw/bordercolor keys (see overlayFilters).
  effect?: TextEffect;
  // Accent bar for the text (the title-card treatment): a solid drawbox emitted right after the
  // drawtext (see overlayFilters / overlayParsing). A plain string is the colour with the default
  // geometry (a 6em underline below the text); an AccentBar object adds position/length/thickness/
  // align knobs. Omitted = no bar.
  accent?: string | AccentBar;
}

// Per-section playback tempo (descriptor options.speed, engine FormatterManager). NOTE the descriptor
// value is a PTS multiplier, NOT a rate: speed 2 = slow motion at half rate, speed 0.5 = twice as fast.
// The builder UI presents the intuitive rate (×) and converts (see speedRate helpers web-side).
// Omitted means normal speed (1).
export type VisualPlayback = { speed?: number };

export interface EditorCaption {
  text: string;
  textI18n?: DescriptorCaption['text'];
  position?: CaptionPosition;
  style?: CaptionStyle;
  align?: CaptionAlign;
  // A registry id, a raw .ttf filename, or a font named by family (`{ family, weight?, style? }`),
  // carried through untouched so a template authored by hand or through MCP keeps its face.
  font?: FontInput;
  fontsize?: number;
  color?: string;
  box?: boolean;
  boxColor?: string;
  boxOpacity?: number;
  // Animated entrance for the caption (fade/rise/slide); stored as the descriptor shape.
  reveal?: Reveal;
  // Drop shadow / outline for legibility; stored as the descriptor shape (pass-through).
  effect?: TextEffect;
  // Opt-in wrapping to the frame (greedy / balanced) and shrink-to-fit; carried through untouched.
  wrap?: DescriptorCaption['wrap'];
  fit?: DescriptorCaption['fit'];
}

export interface VisualCaption {
  caption?: EditorCaption;
}

// A looping animated overlay (.apng/.webp/.gif/.webm) composited over a visual section — a brand
// border, falling confetti, an icon flourish. `url` is a library path (/assets/animations/x.apng)
// or an uploaded blob/data URL; `label` is the library name or uploaded filename, shown in the picker.
// `position`/`scale` tune the overlay for the template: "x:y" output px and "w:h" pre-composite px
// (-1 = keep aspect). Both optional — omitted means top-left at the file's native size.
export interface AnimationOverlay {
  // Editor-only stable key for list rendering/reorder; never written to the descriptor. Optional so
  // the picker can emit a transient overlay (url+label) before the list wrapper attaches an id.
  id?: string;
  url: string;
  label?: string;
  position?: string;
  scale?: string;
  // How the overlay maps into its "w:h" scale box: 'contain' letterboxes (transparent padding),
  // 'cover' fills and centre-crops. Omitted/'stretch' keeps the free w:h scale (may distort).
  fit?: OverlayFit;
  // Playback extent — exactly one of these is active (the builder's mode control enforces it):
  // `loop` (forever) → `-stream_loop -1`; `loops` (finite count) → `-stream_loop N-1`; `duration`
  // (seconds) → `-stream_loop -1 -t D`. Engine precedence: duration > loops > loop.
  loop?: boolean;
  loops?: number;
  duration?: number;
  // Seconds to delay the overlay before it appears (via -itsoffset). Default 0 = from the beginning.
  start?: number;
  // `persistent` → overlay `eof_action=repeat` (freeze the last frame on end) once the overlay ends.
  persistent?: boolean;
  // Overlay alpha, 0–1. Omitted means fully opaque (1).
  opacity?: number;
  // Clockwise rotation in degrees applied to the overlay before compositing. Omitted/0 = upright.
  rotation?: number;
  // Mirror applied before the rotation (engine hflip/vflip on the overlay leg). Omitted = unmirrored.
  flip?: OverlayFlip;
  // Animated entrance for the overlay (rise/slide/fade), reusing the reveal vocabulary; pass-through.
  motion?: Reveal;
}

// A positionable still-image layer on a video section — dragged/resized exactly like an
// AnimationOverlay, but a static image picked from the library or uploaded. The source is a
// MediaChoice (library / upload / url) so large images stay out of the descriptor (uploads resolve
// to `media://<key>` and are materialized at compile), unlike animations which inline a data: URL.
// `position`/`scale` use the same "x:y" output-px / "w:h" pre-composite-px convention as animations.
// `id` is an editor-only stable key for list rendering/reorder; it is never written to the descriptor.
export interface ImageOverlay {
  id: string;
  choice: MediaChoice;
  position?: string;
  scale?: string;
  // How the image maps into its "w:h" scale box — same convention as AnimationOverlay.fit, so a
  // drag-resized logo can keep its aspect instead of stretching.
  fit?: OverlayFit;
  // Overlay alpha, 0–1. Omitted means fully opaque (1). Same convention as AnimationOverlay.opacity.
  opacity?: number;
  // Clockwise rotation in degrees applied to the image before compositing. Omitted/0 = upright.
  rotation?: number;
  // Mirror applied before the rotation — same convention as AnimationOverlay.flip. Omitted = unmirrored.
  flip?: OverlayFlip;
  // Show window, in section-relative seconds. `start` = when the image appears (omitted/0 = from the
  // section start); `end` = when it disappears (omitted/0 = until the section ends). Stored on the
  // descriptor input as start/duration (duration = end - start) and lowered by the engine to the
  // overlay filter's timeline enable — unlike AnimationOverlay, whose start/duration are source flags.
  start?: number;
  end?: number;
  // Animated entrance for the image (rise/slide/fade), reusing the reveal vocabulary; pass-through.
  motion?: Reveal;
  // Set when this overlay is a builder-drawn SHAPE element: the vector recipe (kind/colour/corner
  // radius/stroke) the builder rasterized into the choice's PNG data: URL. The builder regenerates
  // the PNG whenever these params change; the engine composites the PNG and ignores this field.
  // Absent on a plain picked/uploaded image.
  shape?: ShapeSpec;
}

// A whole-video image watermark (descriptor global.watermark) authored once per template — e.g. a
// logo composited over every section. `image` is a MediaChoice (library / upload / url), same
// vocabulary as ImageOverlay.choice, so it reuses markerFromChoice/choiceFromMarker unchanged.
// position/scale/opacity/margin mirror the engine schema's presentation fields verbatim (omitted =
// engine defaults: bottom-right, 0.12, 0.8, 24).
export interface WatermarkChoice {
  image: MediaChoice;
  position?: WatermarkPosition;
  scale?: number;
  opacity?: number;
  margin?: number;
}

export interface VisualAnimation extends MotionBlocks {
  // Animated overlays composited over the section, in array order (later entries paint on top).
  // Author-set; empty/absent means none.
  animations?: AnimationOverlay[];
  // kinetic / camera / graphics come from MotionBlocks (motion-passthrough.ts).
}

export type EditorSection =
  | { kind: 'form'; fields: FormField[] }
  | { kind: 'partial'; ref: string; prefix?: string; variables: { name: string; value: string }[] }
  | ({
      kind: 'video';
      duration: number;
      mute: boolean;
      // Asset-backed clip source (a brand bumper / stock clip): when set, the section plays this
      // fixed video instead of asking the end-user to film — emitted as `type: 'video'` +
      // `options.videoUrl` (the engine's VideoSegment scale/crop + re-encode path, LGPL-safe).
      // Absent = a camera scene (`type: 'project_video'`). Recorder-only fields (countdown,
      // description, captureMode, framingGuide) are ignored while a clip source is set.
      videoUrl?: MediaChoice;
      overlays: TextOverlay[];
      // Recording instructions shown to the end-user while they film this scene
      // (e.g. "Stand centered, look at the camera, say your name"). Emitted as the
      // section's `description` Translation; surfaced by both recorders, never burned in.
      description?: string;
      countdown: boolean;
      countdownSeconds: number;
      // Editor-only: true once the author hand-edits countdownSeconds, which stops it
      // from auto-tracking the clip duration. Never written to the descriptor.
      countdownCustomized?: boolean;
      transitionAfter?: SectionTransition;
      look?: string;
      grade?: Grade;
      // Cinemascope-style horizontal bars simulating a wider aspect ratio (descriptor shape, pass-through).
      letterbox?: Letterbox;
      motion?: MotionEffect[];
      // Background removal: key out a solid screen colour and composite over a solid colour (descriptor shape).
      chromaKey?: ChromaKey;
      // Structured lower-third band composited over the recorded clip (descriptor shape, passed through).
      lowerThird?: LowerThird;
      framingGuide?: FramingGuide;
      // Recorder mode preselected when the end-user films this scene (omitted = front camera).
      captureMode?: CaptureMode;
      // Modes the end-user may switch to; omitted = all four. A single element locks to one mode.
      allowedCaptureModes?: CaptureMode[];
      // Still-image layers dragged/resized on the preview and composited OVER the recorded clip,
      // in array order (later entries paint on top). Author-set; empty/absent means none.
      images?: ImageOverlay[];
      // How the recorded clip / fixed video maps into the output frame; omitted = 'cover'.
      fit?: SectionFit;
      // Footage edits without builder controls (pass-through, see FootageEdits).
      footage?: FootageEdits;
    } & VisualAudio &
      VisualPlayback &
      VisualCaption &
      VisualAnimation &
      VideoFilterFields)
  | ({
      kind: 'color';
      duration: number;
      color: string;
      transitionAfter?: SectionTransition;
      look?: string;
      grade?: Grade;
      // Cinemascope-style horizontal bars simulating a wider aspect ratio (descriptor shape, pass-through).
      letterbox?: Letterbox;
      motion?: MotionEffect[];
      // Structured title card (kicker/headline/subtitle) drawn on the background (descriptor shape).
      titleCard?: TitleCard;
      layers?: BackgroundLayer[];
      // Draggable/resizable text overlays drawn over the background, same model as video sections.
      overlays: TextOverlay[];
      // Still-image layers dragged/resized on the preview and composited OVER the background,
      // in array order (later entries paint on top). Author-set; empty/absent means none.
      images?: ImageOverlay[];
    } & VisualAudio &
      VisualPlayback &
      VisualCaption &
      VisualAnimation)
  | { kind: 'music'; allowed: string[]; allowUpload: boolean }
  | ({
      kind: 'image';
      allowed: string[];
      allowUpload: boolean;
      duration: number;
      transitionAfter?: SectionTransition;
      look?: string;
      grade?: Grade;
      // Cinemascope-style horizontal bars simulating a wider aspect ratio (descriptor shape, pass-through).
      letterbox?: Letterbox;
      motion?: MotionEffect[];
      // Draggable/resizable text overlays drawn over the background image, same model as video sections.
      overlays: TextOverlay[];
      // Still-image layers dragged/resized on the preview and composited OVER the background image,
      // in array order (later entries paint on top). Author-set; empty/absent means none.
      images?: ImageOverlay[];
      // How the picked/uploaded background image maps into the output frame; omitted = 'cover'.
      fit?: SectionFit;
      // Blur-fill tuning / crop focus without builder controls (pass-through, see FootageEdits).
      footage?: FootageEdits;
    } & VisualAudio &
      VisualPlayback &
      VisualCaption &
      VisualAnimation);

export type { Orientation };

// Global audio mix applied across the whole composition: the recorded clips' own audio
// (sourceVolume) vs the background music (musicVolume), each 0..1. normalize/ducking are
// finishing options surfaced by the builder. `ducking` mirrors the descriptor union: false = off,
// true = engine defaults, object = fine-tuned threshold/ratio/attack/release (DuckingSchema).
export interface AudioMix extends AudioMixPassthrough {
  sourceVolume: number;
  musicVolume: number;
  normalize?: 'loudnorm' | 'dynaudnorm';
  ducking: boolean | DuckingSettings;
}

export const DEFAULT_AUDIO_MIX: AudioMix = { sourceVolume: 1, musicVolume: 0.5, ducking: false };

// Opacity used for a framing-guide silhouette when none is authored. Shared by the authoring
// pickers (web + expo) and the live recording overlays so an unspecified guide renders exactly as
// a freshly-added one. The guide is a recording aid only — never burned into the video.
export const DEFAULT_FRAMING_OPACITY = 0.45;

export interface EditorState extends EditorMeta {
  id: string;
  // Motion settings (global.seed, global.motion); absent when the template sets none.
  motion?: EditorMotion;
  // Per-format compositions (descriptor.formats), carried verbatim; absent when the template declares none.
  formats?: EditorFormats;
  name: string;
  description: string;
  orientation: Orientation;
  sections: EditorSection[];
  globalVariables: { name: string; value: string }[];
  audio: AudioMix;
  defaultTransition: DefaultTransition;
  // Whole-video animation overlays (descriptor global.animations) — composited over the final joined
  // video so they span every section, unlike a section's own animation. Empty means none.
  globalAnimations: AnimationOverlay[];
  // Whole-video TEXT overlays (descriptor global.overlays) — e.g. a brand watermark authored once and
  // composited onto every section (or a named subset). Empty means none.
  globalOverlays: GlobalTextOverlay[];
  // Whole-video image watermark (descriptor global.watermark) — a logo authored once per template,
  // composited over the final joined video. Absent means no watermark.
  watermark?: WatermarkChoice;
  // Whole-video colour grade applied across every section (descriptor global.look / global.grade).
  globalLook?: string;
  globalGrade?: Grade;
  // The template's colour palette, 1-indexed as '{{ colorN }}' tokens in any colour field. Emitted
  // to BOTH descriptor locations: global.colorsList (the schema's user-facing palette, read by the
  // apps' template screens) and global.variables.colorsList (where the engine's
  // FormatterManager.formatColor resolves the tokens at compile). Absent/empty means no palette.
  colorsList?: string[];
}

/** Minimal shape needed to re-hydrate the editor from a saved template (web Template + expo UserTemplate both satisfy it). */
export interface EditableTemplate {
  id: string;
  name: string;
  description: string;
  orientation: Orientation;
  descriptor: TemplateDescriptor;
}

export const SECTION_LABELS: Record<EditorSection['kind'], string> = {
  form: 'Form fields',
  partial: 'Partial',
  video: 'Your video',
  color: 'Color background',
  music: 'Music selection',
  image: 'Background image',
};

export const SECTION_KINDS: Array<EditorSection['kind']> = ['video', 'form', 'color', 'music', 'image', 'partial'];

// A fresh, centered text overlay with sensible defaults.
export function newOverlay(): TextOverlay {
  return {
    text: '',
    x: 0.5,
    y: 0.5,
    fontsize: 48,
    fontcolor: '#ffffff',
    font: DEFAULT_FONT_ID,
    box: false,
    boxcolor: '#000000',
    boxOpacity: 0.5,
  };
}

// Resolve a font id from a stored drawtext `fontfile`, falling back to the
// default font when the file is unknown or missing (a positioned text overlay only carries a registry
// id). Caption / title-card / global-overlay fonts never come through here: the editor keeps them as
// authored, a font named by family included, and a picker only replaces one when another is chosen.
export function fontIdFromFile(file: FontInput | undefined): string {
  return (typeof file === 'string' ? findFontByFile(file)?.id : undefined) ?? DEFAULT_FONT_ID;
}

export function newSection(kind: EditorSection['kind']): EditorSection {
  if (kind === 'form') return { kind: 'form', fields: [{ name: 'field_1', label: 'Label', maxLength: 40 }] };

  if (kind === 'partial') return { kind: 'partial', ref: '', variables: [] };

  if (kind === 'color') return { kind: 'color', duration: 3, color: '#7C83FD', overlays: [] };

  if (kind === 'music') return { kind: 'music', allowed: [], allowUpload: false };

  if (kind === 'image') return { kind: 'image', allowed: [], allowUpload: false, duration: 4, overlays: [] };

  return { kind: 'video', duration: 8, mute: false, overlays: [], countdown: false, countdownSeconds: 4 };
}

export function makeTemplateId(): string {
  try {
    // Typed as optional: the DOM lib guarantees crypto.randomUUID, but Hermes (RN) may not have it.
    const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    const uuid = webCrypto?.randomUUID?.();

    if (uuid) return `user-${uuid}`;
  } catch {
    // fall through to a timestamp-based id
  }

  return `user-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}
