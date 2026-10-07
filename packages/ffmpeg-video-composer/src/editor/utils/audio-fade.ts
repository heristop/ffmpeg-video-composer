import type { ProjectConfig, SectionOptions } from '@/core/types';
import { engineCapabilities } from './filter-compat';
import { voiceChain } from '@/core/audio/voice-presets';
import { automationFilter } from '@/core/audio/automation';
import { seconds } from '@/core/timing/seconds';

type AudioFadeEntry = { duration: number; curve?: string };
type AudioEffect = 'echo' | 'telephone' | 'muffled';

// Voice-effect presets lowered onto the section `-af` chain, ahead of any fades. `telephone` is a
// two-filter comma chain in a single table value (highpass then lowpass) — not a FilterManager
// filter object, so it isn't FILTER_COMPAT-routed; see ENGINE_EMITTED_FILTERS/common.sh for the
// individual `aecho`/`highpass`/`lowpass` device-filter entries this table depends on.
const AUDIO_EFFECT_FILTERS: Record<AudioEffect, string> = {
  echo: 'aecho=0.8:0.7:60:0.4',
  telephone: 'highpass=f=300,lowpass=f=3400',
  muffled: 'lowpass=f=1200',
};

function buildFadePart(type: 'in' | 'out', st: number, entry: AudioFadeEntry): string {
  const curveStr = entry.curve ? `:curve=${entry.curve}` : '';

  return `afade=t=${type}:st=${st}:d=${entry.duration}${curveStr}`;
}

/** The fade-in part, if configured. */
function buildFadeInPart(fade: SectionOptions['audioFade']): string[] {
  if (!fade?.in) {
    return [];
  }

  return [buildFadePart('in', 0, fade.in)];
}

/** The fade-out part, if configured. A negative start would silence audio from t=0 when the
 * section duration is unknown or shorter than the fade, so the start clamps to 0. */
function buildFadeOutPart(fade: SectionOptions['audioFade'], duration: number): string[] {
  if (!fade?.out) {
    return [];
  }

  return [buildFadePart('out', Math.max(0, duration - fade.out.duration), fade.out)];
}

// The voice clean-up stages the engine can run (options.voice).
function voicePart(opts: SectionOptions | undefined, config: ProjectConfig | undefined): string[] {
  if (!opts?.voice) return [];

  return voiceChain(opts.voice, config ? engineCapabilities(config).deviceFilters : null);
}

// The clip-sound volume automation (options.audioAutomation), times already resolved to seconds.
function automationPart(opts: SectionOptions | undefined): string[] {
  const keys = opts?.audioAutomation?.map((key) => ({ ...key, at: seconds(key.at) ?? 0 }));
  const filter = automationFilter(keys);

  return filter === null ? [] : [filter];
}

// The voice clean-up, the creative effect, the volume automation, then the fades (the fade-out timed
// against the section length).
function processingParts(
  opts: SectionOptions | undefined,
  config: ProjectConfig | undefined,
  duration: number | undefined
): string[] {
  const effect = opts?.audioEffect;

  return [
    ...voicePart(opts, config),
    ...(effect ? [AUDIO_EFFECT_FILTERS[effect]] : []),
    ...automationPart(opts),
    ...buildFadeInPart(opts?.audioFade),
    ...buildFadeOutPart(opts?.audioFade, duration ?? 0),
  ];
}

/**
 * Builds the `-af` argument string for a section's voice preset + audio effect + automation + fades,
 * or returns '' when none is configured or the section is muted (processing a silent track is
 * pointless). Chain order: the voice clean-up works on the raw recording, then the creative effect
 * (echo/telephone/muffled), then the volume automation, and the fades last so they still ramp the
 * final level in and out. `config` selects the engine: a voice stage its filter allowlist lacks is
 * skipped (core/audio/voice-presets.ts).
 *
 * `pad` appends `apad` for a clip's own (finite) audio encoded with `-shortest`: a phone clip whose
 * audio ends a few frames before its video would otherwise end the segment early, dropping those video
 * frames. Padded with silence, the audio never ends first, so `-shortest` (and `-t`) cut at the video.
 *
 * `footage` carries the clip-range / ramp / freeze audio prefix and the edited section length the
 * fade-out is timed against (utils/footage-section.ts); its default leaves the chain unchanged.
 */
export function buildAudioFadeArg(
  opts: SectionOptions | undefined,
  pad = false,
  config?: ProjectConfig,
  footage: { head: string[]; duration?: number } = { head: [] }
): string {
  const chain = buildAudioFadeChain(opts, pad, config, footage);

  return chain === '' ? '' : ` -af "${chain}" `;
}

/**
 * The bare chain buildAudioFadeArg wraps in `-af` ('' when none): the same parts, for a section that folds
 * its audio processing into a complex filtergraph (editor/footage/).
 */
export function buildAudioFadeChain(
  opts: SectionOptions | undefined,
  pad = false,
  config?: ProjectConfig,
  footage: { head: string[]; duration?: number } = { head: [] }
): string {
  if (opts?.muteSection === true) {
    return '';
  }

  return [
    // Footage edits (utils/footage-lowering.ts) retime the clip sound before any processing or fade.
    ...footage.head,
    ...processingParts(opts, config, footage.duration ?? opts?.duration),
    ...(pad ? [padFilter(footage.duration)] : []),
  ].join(',');
}

// Silence up to the edited length when it is known: an open-ended `apad` lets `-shortest` overrun the
// picture by a few audio frames on FFmpeg 8 (av_drift). Unedited clips keep the plain pad.
function padFilter(length: number | undefined): string {
  return length === undefined ? 'apad' : `apad=whole_dur=${Number(length.toFixed(6))}`;
}
