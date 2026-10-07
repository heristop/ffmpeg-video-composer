// Re-hydration of the template-wide `global` settings: palette, author variables, audio mix and the
// default transition. Split out of to-editor-state.ts for its line budget.
import type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import {
  DEFAULT_AUDIO_MIX,
  DEFAULT_TRANSITION,
  type AudioMix,
  type DefaultTransition,
  type EditorState,
} from './model';
import type { AudioMixPassthrough } from './motion-passthrough';

// Recover the template palette: prefer the schema's user-facing global.colorsList, falling back to
// the engine slot (global.variables.colorsList) for descriptors authored before the palette editor.
export function colorsListFrom(global: TemplateDescriptor['global']): string[] {
  if (global?.colorsList && global.colorsList.length > 0) return global.colorsList;

  const engineSlot = global?.variables?.colorsList;

  return Array.isArray(engineSlot) ? engineSlot : [];
}

// String entries of a descriptor's global.variables become editable author
// rows; string[] entries (the colorsList palette) are skipped — the palette
// hydrates into EditorState.colorsList instead (see colorsListFrom).
export function globalVariablesFrom(global: TemplateDescriptor['global']): EditorState['globalVariables'] {
  return Object.entries(global?.variables ?? {})
    .filter(([, val]) => typeof val === 'string')
    .map(([name, value]) => ({ name, value: value as string }));
}

export function audioFrom(global: TemplateDescriptor['global']): AudioMix {
  const a = global?.audio;

  return {
    sourceVolume: a?.sourceVolume ?? DEFAULT_AUDIO_MIX.sourceVolume,
    musicVolume: a?.musicVolume ?? DEFAULT_AUDIO_MIX.musicVolume,
    ...(a?.normalize ? { normalize: a.normalize } : {}),
    ducking: duckingFrom(a?.ducking),
    ...audioPassthroughFrom(global),
  };
}

// Music-bed automation, auto sound effects and global.sfx: no builder controls yet, carried verbatim.
function audioPassthroughFrom(global: TemplateDescriptor['global']): AudioMixPassthrough {
  const a = global?.audio;

  return {
    ...(a?.automation ? { automation: a.automation } : {}),
    ...(a?.sfx ? { sfx: a.sfx } : {}),
    ...(global?.sfx ? { cues: global.sfx } : {}),
  };
}

// Recover the ducking union: a stored fine-tune object survives as-is; anything truthy else is `true`.
function duckingFrom(ducking: unknown): AudioMix['ducking'] {
  if (ducking && typeof ducking === 'object') return ducking;

  return Boolean(ducking);
}

export function defaultTransitionFrom(global: TemplateDescriptor['global']): DefaultTransition {
  return {
    type: global?.transition?.type ?? DEFAULT_TRANSITION.type,
    duration: global?.transition?.duration ?? DEFAULT_TRANSITION.duration,
    ...(global?.transition?.ease === undefined ? {} : { ease: global.transition.ease }),
  };
}
