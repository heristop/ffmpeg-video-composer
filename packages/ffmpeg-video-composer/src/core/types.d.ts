// Text-sugar descriptor types (title card / lower third / caption) + the reveal/exit/text-effect
// vocabulary + chroma-key live in a sibling to keep this file under the max-lines budget; re-exported
// so `@/core/types` stays the single entry point.
export type {
  RevealType,
  Reveal,
  Exit,
  TextEffect,
  TitleCard,
  LowerThird,
  ChromaKey,
  Caption,
} from './descriptor-text';
import type { Reveal, TextEffect, TitleCard, LowerThird, ChromaKey, Caption } from './descriptor-text';
import type { FontInput } from './fonts';
import type { EffectReference } from '../schemas/effect-reference.schema';
export type { EffectReference } from '../schemas/effect-reference.schema';
// Visual grade / motion / background-layer config also lives in a sibling for the same budget reason.
export type { ChannelAdjust, GradeConfig, MotionEffect, BackgroundLayer, Letterbox } from './descriptor-visual';
import type { GradeConfig, MotionEffect, BackgroundLayer, Letterbox } from './descriptor-visual';
// Filtergraph primitives (input/filter/map + shape recipe) also live in a sibling for the budget;
// the public ones are re-exported, and Filter/Input/Map imported back for the section declarations below.
export type { ShapeSpec, Map, Filter, FilterValues, MapAnimationInput, OverlayFit, OverlayFlip } from './filter-types';
import type { Filter, Input, Map, Translation, OverlayFit, OverlayFlip } from './filter-types';

export type LogParams = Record<string, unknown>;

// Optional progress/log sink a host (e.g. the `leclap` CLI) can pass to the Node `compile()` so it can
// render live progress and capture the engine's per-segment/ffmpeg logs, mirroring `compileBrowser`'s
// `onProgress`. `onProgress` receives the 0..1 compilation fraction; `onLog` receives every engine log
// line (all levels) regardless of the Pino stdout level, so the host can tee detail to a file.
export type CompileReporter = {
  onProgress?: (fraction: number) => void;
  onLog?: (line: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }) => void;
  // Called once with the cause when compile() resolves null — e.g. a SectionError naming the section.
  onError?: (error: Error) => void;
};
export type ProjectConfig = {
  buildDir?: string;
  assetsDir?: string;
  music?: MusicConfig;
  fields?: Record<string, string>;
  currentLocale?: string;
  codecConfig?: CodecConfig;
  hardwareConfig?: HardwareConfig;
  audioConfig?: AudioConfig;
  videoConfig?: VideoConfig;
  userVideoPaths?: { [sectionName: string]: string };
  // Skip descriptor validation before compiling (trusted callers only; validation is on by default).
  // Applies to the Node `compile()` path only — the browser and React Native paths always validate.
  skipValidation?: boolean;
  // Named render-quality tier resolved by core/encoding.ts (default 'standard'). Encoder numbers
  // (crf/preset/bitrate) stay an app concern — templates never carry them.
  qualityTier?: 'draft' | 'standard' | 'high';
};

export type MusicConfig = {
  name: string;
  url?: string;
};
type CodecConfig = { videoCodec?: string; audioCodec?: string };

// `maxRenderConcurrency`: max segments rendered in parallel on adapters that support it (Node/static
// child processes). Defaults to 3 (capped by segment count); set to 1 to force the serial path.
type HardwareConfig = { hwaccel?: string | null; preset?: string; maxRenderConcurrency?: number };

type AudioConfig = { sampleRate?: number; channelLayout?: string };

export type VideoConfig = { orientation?: string; scale?: string; setsar?: string; fps?: number };

export type ProjectBuildInfos = {
  totalSegments: number;
  totalLength: number;
  currentLength: number;
  currentProgress: number;
  currentIncrement: number;
  durations: Record<string, number>;
  // Per project_video section: whether its source clip has an audio stream. Probed once by the
  // director; false lets the segment add a silent track so transition acrossfade always has audio.
  sourceHasAudio: Record<string, boolean>;
  videoInputs: string[];
  musicInputs: string[];
  musicFilters: string[];
  fileConcatPath: string;
  musicPath: string;
  transitions: Array<{ type: string; duration: number }>;
};

export interface TemplateDescriptor {
  meta?: TemplateMeta;
  global?: TemplateDescriptorGlobal;
  sections?: DescriptorSection[];
}

interface TemplateMeta {
  name?: string;
  description?: string;
  creativeDirection?: string;
}

export interface TemplateDescriptorGlobal {
  variables?: Variables;
  orientation?: string;
  fps?: number;
  colorsList?: string[];
  musicEnabled?: boolean;
  transition?: SectionTransition;
  audio?: GlobalAudio;
  music?: MusicConfig;
  animations?: GlobalAnimation[];
  overlays?: GlobalTextOverlay[];
  watermark?: Watermark;
  look?: string;
  grade?: GradeConfig;
  allowedMusic?: string[];
  allowUploadMusic?: boolean;
  allowedBackgrounds?: string[];
  allowUploadBackground?: boolean;
}

// A whole-video text overlay (global.overlays) composited onto every section (or a named subset).
export interface GlobalTextOverlay {
  text: Translation;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom' | 'center';
  font?: FontInput;
  size?: number;
  color?: string;
  opacity?: number;
  reveal?: Reveal;
  effect?: TextEffect;
  sections?: string[];
}

// A whole-video animation overlay (global.animations) composited over the final joined video.
export interface GlobalAnimation {
  url: string;
  position?: string;
  scale?: string;
  /** Aspect handling within the "w:h" scale box; 'stretch' (or omitted) scales freely. */
  fit?: OverlayFit;
  opacity?: number;
  /** Clockwise rotation in degrees applied to the overlay before compositing. 0 (or omitted) = upright. */
  rotation?: number;
  /** Mirror the overlay before compositing: left-right, top-bottom, or both. */
  flip?: OverlayFlip;
  loop?: boolean;
  /** Finite play count; takes precedence over loop. */
  loops?: number;
  /** Seconds the overlay plays before it ends; takes precedence over loops/loop. */
  duration?: number;
  /** Seconds to delay the overlay before it appears (via -itsoffset); 0/omitted starts at the beginning. */
  start?: number;
  persistent?: boolean;
  /** Animated entrance (rise/slide/fade), same lowering as the per-section overlay path. */
  motion?: Reveal;
}

// The corner a `global.watermark` anchors to; also the position-lowering lookup key in
// editor/presets/watermark.ts (POSITION_EXPRESSIONS).
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

// A still-image watermark composited over the whole video (global.watermark) — pure sugar, lowered by
// watermarkToAnimation (editor/presets/watermark.ts) into a GlobalAnimation entry so it reuses the
// whole-video overlay pipeline untouched.
export interface Watermark {
  url: string;
  position?: WatermarkPosition;
  /** Watermark width as a fraction of the output width, 0.02..0.5 (default 0.12). */
  scale?: number;
  /** Watermark alpha, 0..1 (default 0.8). */
  opacity?: number;
  /** Inset from the frame edges in output pixels, 0..200 (default 24). */
  margin?: number;
}

interface SectionTransition {
  type: string;
  duration?: number;
}

interface DuckingConfig {
  threshold?: number;
  ratio?: number;
  attack?: number;
  release?: number;
}

interface GlobalAudio {
  sourceVolume?: number;
  musicVolume?: number;
  normalize?: 'loudnorm' | 'dynaudnorm';
  ducking?: boolean | DuckingConfig;
  musicFade?: number;
}

export interface Variables {
  [key: string]: string | string[];
}

type DescriptorSection = Section | PartialSection;

export interface Section {
  effect?: EffectReference;
  name: string;
  type: string;
  options?: SectionOptions;
  inputs?: Input[];
  maps?: Map[];
  filters?: Filter[];
  title?: Translation;
  description?: Translation;
  transition?: SectionTransition;
  caption?: Caption;
  titleCard?: TitleCard;
  lowerThird?: LowerThird;
  look?: string;
  grade?: GradeConfig;
  letterbox?: Letterbox;
  motion?: MotionEffect[];
  chromaKey?: ChromaKey;
}

export interface PartialSection {
  type: 'partial';
  name?: string;
  options?: SectionOptions;
  inputs?: Input[];
  maps?: Map[];
  filters?: Filter[];
  title?: Translation;
  description?: Translation;
  transition?: SectionTransition;
  caption?: Caption;
  look?: string;
  grade?: GradeConfig;
  motion?: MotionEffect[];
  ref?: string;
  prefix?: string;
  sections?: unknown[];
  variables?: Record<string, string>;
}

interface AudioFade {
  duration: number;
  curve?: string;
}

export interface SectionOptions {
  upperCase?: boolean;
  lowerCase?: boolean;
  useVideoSection?: string;
  duration?: number;
  musicVolume?: number;
  audioFade?: { in?: AudioFade; out?: AudioFade };
  audioEffect?: 'echo' | 'telephone' | 'muffled';
  fields?: Field[];
  speed?: number;
  muteSection?: boolean;
  countdown?: boolean;
  countdownDuration?: number;
  videoUrl?: string;
  logoUrl?: string;
  backgroundUrl?: string;
  pictureUrl?: string;
  backgroundColor?: string;
  forceAspectRatio?: boolean;
  forceOriginalAspectRatio?: boolean;
  // color_background extension
  layers?: BackgroundLayer[];
  // project_video extension
  framingGuide?: FramingGuideConfig;
  captureMode?: string;
  allowedCaptureModes?: string[];
}

export interface FramingGuideConfig {
  type: 'silhouette';
  position: 'left' | 'center' | 'right';
  opacity?: number;
  style?: 'bust' | 'outline';
}

interface Field {
  name: string;
  maxLength: number;
  label: Translation;
}

export type Media = {
  name: string;
  url?: string;
  path?: string;
  extension?: string;
};

export type TemplateAssets = {
  fonts: Record<string, string>;
  musics: Record<string, string>;
  inputs: string[];
};

export type FFMpegInfos = {
  duration: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
};
