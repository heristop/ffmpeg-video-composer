// Pure filtergraph builders for the music mix and the loudness normalisation (MusicComposer). No IO.

import type { TemplateDescriptorGlobal } from '@/core/types';
import { LOUDNORM_INTEGRATED, LOUDNORM_TRUE_PEAK, type LoudnessTarget } from '@/core/qc/targets';
import { resolvePlatform } from '@/core/platforms';
import { automationFilter } from '@/core/audio/automation';
import { seconds } from '@/core/timing/seconds';
import { sfxOverBed, type SfxGraph } from './sfx-mix';

/** The loudnorm target: the delivery platform's when `global.platform` names one, else the default. */
export function loudnessTarget(global: TemplateDescriptorGlobal | undefined): LoudnessTarget {
  const platform = resolvePlatform(global?.platform);

  return platform
    ? { integrated: platform.loudness.lufs, truePeak: platform.loudness.truePeak }
    : { integrated: LOUDNORM_INTEGRATED, truePeak: LOUDNORM_TRUE_PEAK };
}

/** The single-pass loudnorm filter at a given true-peak ceiling (dBTP). */
export function loudnormFilter(ceiling: number = LOUDNORM_TRUE_PEAK, integrated = LOUDNORM_INTEGRATED): string {
  return `loudnorm=I=${integrated}:TP=${ceiling}:LRA=11`;
}

/**
 * Comma-prefixed normalize filter inserted at the end of the chain that produces [final] (a labeled
 * output ends an ffmpeg chain, so the filter must come BEFORE the label). '' when none is requested.
 */
export function normalizeSuffix(global: TemplateDescriptorGlobal | undefined, ceiling?: number): string {
  const normalize = global?.audio?.normalize;

  if (normalize === 'loudnorm') {
    const target = loudnessTarget(global);

    return `,${loudnormFilter(ceiling ?? target.truePeak, target.integrated)}`;
  }

  return normalize === 'dynaudnorm' ? ',dynaudnorm=f=150:g=15' : '';
}

/** Ducking mix: sidechain-compresses music under voice when ducking is enabled, then amix into `out`. */
export function duckingMix(
  global: TemplateDescriptorGlobal | undefined,
  labels: { music: string; voice: string },
  suffix: string,
  out = 'final'
): string {
  const duckingConfig = global?.audio?.ducking;
  const isDucking = duckingConfig === true || typeof duckingConfig === 'object';

  if (!isDucking) {
    return `[${labels.voice}][${labels.music}]amix=inputs=2:duration=first${suffix}[${out}]`;
  }

  const cfg = typeof duckingConfig === 'object' ? duckingConfig : {};
  const sc = `sidechaincompress=threshold=${cfg.threshold ?? 0.05}:ratio=${cfg.ratio ?? 8}:attack=${cfg.attack ?? 20}:release=${cfg.release ?? 400}`;

  return (
    `[${labels.voice}]asplit=2[vout][vkey]; ` +
    `[${labels.music}][vkey]${sc}[ducked]; ` +
    `[vout][ducked]amix=inputs=2:duration=first:normalize=0${suffix}[${out}]`
  );
}

/**
 * `,volume=eval=frame:...` for `global.audio.automation` on the music bed, '' without it. It runs on the
 * formatted bed, after the per-section musicVolume levels and BEFORE ducking, so the sidechain still
 * dips the automated level under speech.
 */
export function musicAutomationSuffix(global: TemplateDescriptorGlobal | undefined): string {
  const keys = global?.audio?.automation?.map((key) => ({ ...key, at: seconds(key.at) ?? 0 }));
  const filter = automationFilter(keys);

  return filter === null ? '' : `,${filter}`;
}

/**
 * The music pass's output bound: `-t <planned length>` (to the millisecond), or `-shortest` when no
 * length was planned. Not `-shortest` when one is known: with `-c:v copy`, FFmpeg 9 ends the copied
 * video a few frames early under it, and next to `-t` it does the same on FFmpeg 8. `-t` keeps every
 * frame and still cuts a music tail longer than the video. Shorter music was looped to length before.
 */
export function musicPassBound(plannedSeconds: number): string {
  if (!(plannedSeconds > 0)) return '-shortest';

  return `-t ${Number(plannedSeconds.toFixed(3))}`;
}

export interface MixGraphInput {
  global: TemplateDescriptorGlobal | undefined;
  /** The per-section music legs (MusicComposer.prepareMusicTrack), joined when there are several. */
  musicFilters: readonly string[];
  multipleSegments: boolean;
  audioVolumeLevel: number;
  reduceNoiseConfig: string;
  channelConfig: string;
  hasSegmentAudio: boolean;
  /** loudnorm true-peak ceiling for this pass (the true-peak guard lowers it on a retry). */
  ceiling?: number;
  /** Sound effects laid over the mix before normalisation (editor/utils/sfx-mix.ts). */
  sfx?: SfxGraph;
}

/**
 * The music-mix `-filter_complex` producing `[final]`. With sound effects the music/voice mix ends in
 * `[bed]` instead, and the effects are laid over it before the normalize filter, so loudnorm and the
 * true-peak guard measure the finished mix.
 */
export function musicMixGraph(input: MixGraphInput): string {
  const normalize = normalizeSuffix(input.global, input.ceiling);
  const sfx = input.sfx && input.sfx.labels.length > 0 ? input.sfx : null;
  const [suffix, out] = sfx ? ['', 'bed'] : [normalize, 'final'];
  const tail = sfx ? `; ${sfxOverBed('bed', sfx, normalize)}` : '';
  const { channelConfig } = input;
  const legs = input.multipleSegments ? `${input.musicFilters.join(' ')} [lastcrossed]` : '[1:a]';
  const automation = musicAutomationSuffix(input.global);

  // Video-only upload: the concat output has no audio stream, so referencing `[0:a]` would abort
  // ("Stream specifier matches no streams"). Route the music straight to [final] instead of amix-ing it.
  if (!input.hasSegmentAudio) {
    return `${legs}${channelConfig}${automation}${suffix}[${out}]${tail}`;
  }

  const voice = `[0:a]${channelConfig},volume=${input.audioVolumeLevel},${input.reduceNoiseConfig}[audio_formatted]; `;
  const music = `${legs}${channelConfig}${automation}[music_formatted]; `;
  const labels = { music: 'music_formatted', voice: 'audio_formatted' };

  return `${voice}${music}${duckingMix(input.global, labels, suffix, out)}${tail}`;
}

/**
 * The standalone audio pass (no music) with sound effects: the clip sound (silence as long as the video,
 * for a video with no audio stream) as the bed, the effects over it, then the normalize filter. `[final]`.
 */
export function sfxOnlyGraph(
  global: TemplateDescriptorGlobal | undefined,
  sfx: SfxGraph,
  bed: { channelConfig: string; hasSegmentAudio: boolean; total: number; sampleRate: number; ceiling?: number }
): string {
  const normalize = normalizeSuffix(global, bed.ceiling);
  const source = bed.hasSegmentAudio ? '[0:a]' : `anullsrc=r=${bed.sampleRate}:cl=stereo,atrim=duration=${bed.total},`;

  return `${source}${bed.channelConfig}[bed]; ${sfxOverBed('bed', sfx, normalize)}`;
}
