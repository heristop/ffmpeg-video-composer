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
  TimeValue,
  TimedReveal,
  TimedExit,
} from './descriptor-text';
import type { Reveal, RevealEasing, TextEffect, TitleCard, LowerThird, ChromaKey, Caption } from './descriptor-text';
import type { FontInput } from './fonts';
import type { PlatformName } from './platforms';
import type { RenderManifest } from './determinism/manifest';
import type { QcOption, QcReport } from './qc/types';
import type { MotionTokens } from '../schemas/motion.schemas';
import type { Theme } from '../schemas/theme.schemas';
import type { KineticBlock } from '../schemas/kinetic.schemas';
import type { SectionLayout } from '../schemas/layout.schemas';
import type { Camera } from '../schemas/camera.schemas';
import type { Graphic } from '../schemas/graphics.schemas';
// What an fx graphic lives on (frame, rect, pane, layer, kinetic text).
export type { FxTarget, FxRectTarget } from '../schemas/fx.schemas';
import type { Subtitles } from '../schemas/subtitles.schemas';
import type { AutomationKeyInput, SfxCue, VoicePreset } from '../schemas/audio.schemas';
export type { AutomationKeyInput, SfxCue } from '../schemas/audio.schemas';
import type { Beats, BeatsSpec } from './timing/timeline';
import type { SectionRole } from '../schemas/section-intent.schemas';
export type { Beats, BeatsSpec } from './timing/timeline';
import type { TemplateFormats } from '../schemas/formats.schemas';
import type { EffectReference } from '../schemas/effect-reference.schema';
export type { EffectReference } from '../schemas/effect-reference.schema';
// Visual grade / motion / background-layer config also lives in a sibling for the same budget reason.
export type { ChannelAdjust, GradeConfig, MotionEffect, BackgroundLayer, Letterbox } from './descriptor-visual';
import type { GradeConfig, MotionEffect, BackgroundLayer, Letterbox } from './descriptor-visual';
export type * from './descriptor-footage';
import type {
  ClipRange,
  FitFill,
  Focus,
  FootageFit,
  Freeze,
  LookInput,
  ProbedTraits,
  SectionTakeFields,
  SpeedRamp,
  TakeBuildInfos,
  TakeOptions,
} from './descriptor-footage';
// Filtergraph primitives (input/filter/map + shape recipe) also live in a sibling for the budget;
// the public ones are re-exported, and Filter/Input/Map imported back for the section declarations below.
export type {
  ShapeSpec,
  Map,
  Filter,
  FilterGraphChain,
  FilterValues,
  MapAnimationInput,
  OverlayFit,
  OverlayFlip,
} from './filter-types';
import type { Filter, Input, Map, Translation } from './filter-types';
// Whole-video overlays (global.overlays / animations / watermark) live in a sibling for the budget too.
export type { GlobalTextOverlay, GlobalAnimation, WatermarkPosition, Watermark } from './descriptor-global';
import type { GlobalTextOverlay, GlobalAnimation, Watermark } from './descriptor-global';

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
  // Node only. When set, compile() builds the render manifest (template/graph/asset/output digests, see
  // core/determinism/manifest.ts) after a successful render and hands it here. Hashing costs one read of
  // the output and inputs, so it only runs when a host asks for it.
  onManifest?: (manifest: RenderManifest) => void;
  // Node only. Called with the output QC report (core/qc) after a successful render when
  // `ProjectConfig.qc` is set; the same report is also recorded in the manifest's `qc` field.
  onQc?: (report: QcReport) => void;
};
export type ProjectConfig = {
  buildDir?: string;
  assetsDir?: string;
  music?: MusicConfig;
  /** Values for form fields and declared `global.fields` (coerced to each field's type). */
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
  // Deterministic encoder profile (bit-exact muxing, fixed libx264 threads), applied to every FFmpeg
  // command of the build. Default: on; false opts out (faster local drafts).
  deterministic?: boolean;
  // Node only. Probe the finished output and report findings (duration, frames, A/V drift, pixel format,
  // colour tags, audio); `{ content: true }` also decodes it once for black/frozen/silent stretches and
  // loudness. Delivered through `CompileReporter.onQc` and the manifest. Default: off.
  qc?: QcOption;
  // Node only. Directory of the per-section render cache: a section whose FFmpeg command, input files,
  // FFmpeg build and engine version all match a previous render is copied instead of re-encoded.
  cacheDir?: string;
  // Format to render (core/formats: `formats[format]` + `$format` values); default: the own orientation.
  format?: 'landscape' | 'portrait' | 'square';
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

export type ProjectBuildInfos = TakeBuildInfos & {
  totalSegments: number;
  totalLength: number;
  currentLength: number;
  currentProgress: number;
  currentIncrement: number;
  durations: Record<string, number>;
  // Per project_video section: whether its source clip has an audio stream. Probed once by the
  // director; false lets the segment add a silent track so transition acrossfade always has audio.
  sourceHasAudio: Record<string, boolean>;
  // Per probed clip: its full source length, before footage edits (clip range / ramp / freeze), which
  // `durations` already account for. Optional so hand-built build infos (tests) stay valid.
  sourceDurations?: Record<string, number>;
  videoInputs: string[];
  musicInputs: string[];
  musicFilters: string[];
  fileConcatPath: string;
  musicPath: string;
  transitions: Array<{ type: string; duration: number; ease?: RevealEasing }>;
};

export interface TemplateDescriptor {
  meta?: TemplateMeta;
  global?: TemplateDescriptorGlobal;
  sections?: DescriptorSection[];
  /** Per-format compositions of the same story: patches applied when that orientation renders (core/formats). */
  formats?: TemplateFormats;
}

interface TemplateMeta {
  name?: string;
  description?: string;
  creativeDirection?: string;
  /** The production brief (one-liner or path); opts into the section_without_purpose advisory. */
  brief?: string;
  /** Ask every rendering section for a `purpose` (advisory). */
  requirePurpose?: boolean;
}

export interface TemplateDescriptorGlobal {
  variables?: Variables;
  /**
   * The typed input contract filled into `{{ name }}` placeholders (core/fields). Spelled structurally here
   * (the file's dependency budget); schemas/fields.schemas.ts holds the exact shape.
   */
  fields?: Record<string, TypedFieldSpec> | Array<TypedFieldSpec & { name: string }>;
  orientation?: string;
  /** Delivery platform id or alias (core/platforms.ts): orientation default, safe zones, loudness. */
  platform?: PlatformName;
  /** Colour emoji in drawn text: composited bundled images (default), stripped, or a validation error. */
  emoji?: 'image' | 'strip' | 'error';
  /** Root seed (uint32) for procedural effects; each element derives hash(seed, path). Default 0. */
  seed?: number;
  /** Motion tokens + energy, see schemas/motion.schemas.ts. */
  motion?: MotionTokens;
  /** Theme: a built-in name or { extends, colors, fonts, radius, motion }, see schemas/theme.schemas.ts. */
  theme?: Theme;
  /**
   * Beat grid of the whole video for "beat:n" / "bar:n" time references (core/timing/timeline.ts), or
   * `{ analyze: 'music' }`, measured from the music track by the Node compile before references resolve.
   */
  beats?: BeatsSpec;
  fps?: number;
  colorsList?: string[];
  musicEnabled?: boolean;
  transition?: SectionTransition;
  audio?: GlobalAudio;
  /** Sound effects on the whole-video timeline. */
  sfx?: SfxCue[];
  music?: MusicConfig;
  animations?: GlobalAnimation[];
  overlays?: GlobalTextOverlay[];
  watermark?: Watermark;
  look?: LookInput;
  grade?: GradeConfig;
  allowedMusic?: string[];
  allowUploadMusic?: boolean;
  allowedBackgrounds?: string[];
  allowUploadBackground?: boolean;
}

interface SectionTransition {
  type: string;
  duration?: number;
  /** Curve of a designed transition. */
  ease?: RevealEasing;
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
  /** Music-bed volume automation on the whole-video timeline (core/audio/automation.ts). */
  automation?: AutomationKeyInput[];
  /** 'auto' places sound effects from the motion (core/audio/auto-sfx.ts). */
  sfx?: 'auto';
}

interface TypedFieldSpec {
  type: 'text' | 'color' | 'url' | 'media' | 'number' | 'enum' | 'time';
  default?: string | number;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: string[];
  label?: Record<string, string>;
  description?: string;
}

export interface Variables {
  [key: string]: string | string[];
}

type DescriptorSection = Section | PartialSection;

export interface Section extends SectionTakeFields {
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
  kinetic?: KineticBlock[];
  camera?: Camera;
  graphics?: Graphic[];
  /** Named moments in seconds from the section start, referenced as "cue:<name>" in time fields. */
  cues?: Record<string, number>;
  /** Word-timed captions (cues, SRT or word timings) drawn in a caption DNA with optional karaoke. */
  subtitles?: Subtitles;
  /** Sound effects placed in this section (section time). */
  sfx?: SfxCue[];
  look?: LookInput;
  grade?: GradeConfig;
  letterbox?: Letterbox;
  motion?: MotionEffect[];
  chromaKey?: ChromaKey;
  /** Split screen / before-after wipe (schemas/layout.schemas.ts). */
  layout?: SectionLayout;
  /** Why the section exists; authoring metadata, never rendered. */
  purpose?: string;
  /** Narrative role (hook, problem, product-intro, reveal, proof, cta, outro, bridge); never rendered. */
  role?: SectionRole;
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
  look?: LookInput;
  grade?: GradeConfig;
  motion?: MotionEffect[];
  ref?: string;
  prefix?: string;
  sections?: unknown[];
  variables?: Record<string, string>;
  /** Total seconds for this use; only the hold between the partial envelope IN and OUT stretches. */
  duration?: number;
  /** Snap a partial sync point onto a beat/cue by resizing the section before the ref. */
  align?: { sync: string; to: number | string };
}

interface AudioFade {
  duration: number;
  curve?: string;
}

export interface SectionOptions extends TakeOptions {
  upperCase?: boolean;
  lowerCase?: boolean;
  useVideoSection?: string;
  /**
   * Seconds. A template may author `{ beats }` / `{ bars }` (schemas/time.schemas.ts BeatDuration); the
   * time-reference pass turns it into seconds before anything is lowered (core/timing/durations.ts).
   */
  duration?: number;
  musicVolume?: number;
  audioFade?: { in?: AudioFade; out?: AudioFade };
  audioEffect?: 'echo' | 'telephone' | 'muffled';
  /** Voice clean-up preset for the clip's own sound (video / project_video). */
  voice?: VoicePreset;
  /** Volume automation of the clip's own sound (section time). */
  audioAutomation?: AutomationKeyInput[];
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
  // Reframing (schemas/footage.schemas.ts): fit overrides the two aspect flags above.
  fit?: FootageFit;
  fill?: FitFill;
  focus?: Focus;
  // video / project_video footage edits: source in/out points, speed ramp, freeze frames.
  clip?: ClipRange;
  speedRamp?: SpeedRamp;
  rampAudio?: 'stretch' | 'mute';
  freeze?: Freeze[];
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
  /** Required unless the field binds a non-text `global.fields` entry (the validator checks it). */
  maxLength?: number;
  label: Translation;
}

export type FFMpegInfos = ProbedTraits & {
  duration: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
};
