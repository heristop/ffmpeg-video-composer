// Motion fields the builder has no controls for yet (kinetic typography, the section camera, animated
// graphics, word-timed subtitles, sound effects, designed-transition easing, global.seed, global.motion
// tokens, the global.theme, the global.platform delivery target and the global.fields input contract). The editor carries them
// through in descriptor shape, so opening a template in the builder and saving it never strips them.

import type { SectionOptions, TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { KineticBlock } from 'ffmpeg-video-composer/src/schemas/kinetic.schemas.ts';
import type { Camera } from 'ffmpeg-video-composer/src/schemas/camera.schemas.ts';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { EasingSpecInput, MotionTokens } from 'ffmpeg-video-composer/src/schemas/motion.schemas.ts';
import type { Theme } from 'ffmpeg-video-composer/src/schemas/theme.schemas.ts';
import type { Subtitles } from 'ffmpeg-video-composer/src/schemas/subtitles.schemas.ts';
import type { AutomationKeyInput, SfxCue } from 'ffmpeg-video-composer/src/schemas/audio.schemas.ts';
import type { VoicePreset } from 'ffmpeg-video-composer/src/core/audio/voice-presets.ts';
import type { SectionRole } from 'ffmpeg-video-composer/src/schemas/section-intent.schemas.ts';
import type { PlatformName } from 'ffmpeg-video-composer/src/core/platforms.ts';
import type { FieldsDeclaration } from 'ffmpeg-video-composer/src/schemas/fields.schemas.ts';

export type MotionEase = EasingSpecInput;
export type { EditorFormats } from './formats-passthrough';

/** Template meta the editor carries verbatim (creative direction, brief, purpose requirement, resolve-pass pins). */
export type EditorMeta = Pick<
  NonNullable<TemplateDescriptor['meta']>,
  'creativeDirection' | 'brief' | 'requirePurpose' | 'resolved'
>;

// Footage edits the builder has no controls for yet (blur fill tuning, crop focus, clip range, speed
// ramp, freeze frames): carried through in descriptor shape (options.*) so opening a template in the
// builder and saving it never strips them. Image sections only ever hold fill/focus.
export type FootageEdits = Pick<SectionOptions, 'fill' | 'focus' | 'clip' | 'speedRamp' | 'rampAudio' | 'freeze'>;

/** Per-section motion blocks, plus the section intent (purpose, narrative role): never rendered, carried through. */
export interface MotionBlocks {
  kinetic?: KineticBlock[];
  camera?: Camera;
  graphics?: Graphic[];
  /** Word-timed captions (cues / SRT / word timings, caption DNA, karaoke), carried verbatim. */
  subtitles?: Subtitles;
  /** Section sound effects, carried verbatim. */
  sfx?: SfxCue[];
  /** Why the section exists (authoring metadata). */
  purpose?: string;
  /** Narrative role: hook, problem, product-intro, reveal, proof, cta, outro, bridge. */
  role?: SectionRole;
}

/** Template-wide motion settings. */
export interface EditorMotion {
  seed?: number;
  tokens?: MotionTokens;
  /** global.theme, carried verbatim: `$color.*` / `$font.*` references elsewhere depend on it. */
  theme?: Theme;
  /** global.platform (delivery target: safe zones, duration limits, loudness), carried verbatim. */
  platform?: PlatformName;
  /** global.fields (the typed input contract its `{{ NAME }}` placeholders fill), carried verbatim. */
  fields?: FieldsDeclaration;
}

/** Section audio options the builder has no controls for yet, carried verbatim (options.voice / audioAutomation). */
export interface ClipAudioPassthrough {
  voice?: VoicePreset;
  audioAutomation?: AutomationKeyInput[];
}

/** global.audio.automation / global.audio.sfx and global.sfx (as `cues`), carried verbatim. */
export interface AudioMixPassthrough {
  automation?: AutomationKeyInput[];
  sfx?: 'auto';
  cues?: SfxCue[];
}

export function motionBlocksOf(source: MotionBlocks): MotionBlocks {
  return {
    ...(source.kinetic ? { kinetic: source.kinetic } : {}),
    ...(source.camera ? { camera: source.camera } : {}),
    ...(source.graphics ? { graphics: source.graphics } : {}),
    ...(source.subtitles ? { subtitles: source.subtitles } : {}),
    ...(source.sfx ? { sfx: source.sfx } : {}),
    ...(source.purpose?.trim() ? { purpose: source.purpose.trim() } : {}),
    ...(source.role ? { role: source.role } : {}),
  };
}

/** global.seed, global.motion, global.theme, global.platform and global.fields as editor state, or undefined when the template sets none. */
export function editorMotionFrom(global: TemplateDescriptor['global']): EditorMotion | undefined {
  const motion: EditorMotion = {
    ...(global?.seed === undefined ? {} : { seed: global.seed }),
    ...(global?.motion ? { tokens: global.motion } : {}),
    ...(global?.theme === undefined ? {} : { theme: global.theme }),
    ...(global?.platform ? { platform: global.platform } : {}),
    ...(global?.fields === undefined ? {} : { fields: global.fields }),
  };

  return Object.keys(motion).length > 0 ? motion : undefined;
}

/** The editor motion settings back as `global` fields. */
export function motionGlobalFrom(
  motion: EditorMotion | undefined
): Pick<NonNullable<TemplateDescriptor['global']>, 'seed' | 'motion' | 'theme' | 'platform' | 'fields'> {
  return {
    ...(motion?.seed === undefined ? {} : { seed: motion.seed }),
    ...(motion?.tokens ? { motion: motion.tokens } : {}),
    ...(motion?.theme === undefined ? {} : { theme: motion.theme }),
    ...(motion?.platform ? { platform: motion.platform } : {}),
    ...(motion?.fields === undefined ? {} : { fields: motion.fields }),
  };
}
