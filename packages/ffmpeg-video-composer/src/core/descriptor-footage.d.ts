// Recorded-footage descriptor types: look strength, silence trimming, explicit keep ranges, B-roll
// cutaways and the probed source traits. Split out of `types.d.ts` for its max-lines budget and
// re-exported from there, with the footage editing option types (type-only, from the schemas) and the
// media bookkeeping types. Nothing here imports types.d.ts, so the module graph stays acyclic.
export type { ClipRange, FitFill, Focus, FootageFit, Freeze, SpeedRamp } from '../schemas/footage.schemas';

/** A look preset by name, or `{ preset, strength }` to blend a LUT look toward the untouched footage. */
export type LookInput = string | { preset: string; strength?: number };

/** Silence trimming for a recorded clip: cut leading/trailing silence and long pauses (Node analysis). */
export interface TrimSilence {
  /** Trim leading/trailing silence (default true). */
  edges?: boolean;
  /** Also cut pauses inside the take; `{}` enables it with the defaults. */
  gaps?: { minSilence?: number; margin?: number; threshold?: number };
}

/** One kept window `[from, to]` of the source clip, in source seconds. */
export type KeepRange = [number, number];

export interface Cutaway {
  url: string;
  /** Section time (seconds or a time reference) the cutaway starts at. */
  at: number | string;
  duration: number;
  /** Source time of the cutaway clip to start from (default 0). */
  from?: number;
  /** a = keep the main audio (default), b = the cutaway's audio, mix = both. */
  audio?: 'a' | 'b' | 'mix';
  fit?: 'cover' | 'contain';
}

/** Colour/timing traits read off a probed video stream (core/footage/media-traits.ts). */
export interface MediaTraits {
  hdr: 'pq' | 'hlg' | 'dolby-vision' | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  bitDepth: number | null;
  vfr: boolean;
  /** Display rotation FFmpeg's autorotation applies, normalised to 0/90/180/270. */
  rotation: number;
}

/** What the director resolved for one section's footage before it renders (director/footage-plan.ts). */
export interface SectionFootage {
  /** Source windows kept (explicit options.keep, or computed by trimSilence), in source seconds. */
  keep?: KeepRange[];
  /** Tone-map an HDR source to SDR in the section graph. */
  tonemap?: boolean;
  traits?: MediaTraits;
  /** False when the probed source has no audio stream. */
  hasAudio?: boolean;
}

/** Take-editing options of video / project_video sections (merged into SectionOptions). */
export interface TakeOptions {
  trimSilence?: TrimSilence;
  keep?: KeepRange[];
}

/** Section-level take fields (merged into Section). */
export interface SectionTakeFields {
  /** B-roll clips overlaid on a video/project_video section's footage for a window. */
  cutaways?: Cutaway[];
}

/** Build infos the take plan fills (merged into ProjectBuildInfos). */
export interface TakeBuildInfos {
  /** Per video/project_video section: the take plan resolved at probe time (director/footage-plan.ts). */
  footage?: Record<string, SectionFootage>;
}

/** Probe traits an adapter may add to FFMpegInfos. */
export interface ProbedTraits {
  /** Colour/timing traits of the video stream, when the adapter reports them. */
  traits?: MediaTraits;
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
