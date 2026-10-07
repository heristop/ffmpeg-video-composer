// Footage edits lowered into the section's own filtergraph: the kept source windows (trim/atrim +
// concat), the HDR tone-map, and B-roll cutaways (overlay with an enable window, audio a/b/mix) run on
// the main clip BEFORE the section's usual chain (scale, grade, text…), which then reads the edited
// stream. Every filter here is on the on-device allowlist except the tone-map, which the director only
// requests when the build has zscale/tonemap (director/footage-plan.ts). Pure: same plan, same graph.

import type { KeepRange } from '@/core/types';
import { TONEMAP_CHAIN } from '@/core/footage/analyzer';
import { cutawayAudio, cutawayVideo, type FootageLegs as Legs, type ResolvedCutaway } from './cutaway-graph';

export type { ResolvedCutaway } from './cutaway-graph';

export interface FootageAudioFormat {
  sampleRate: number | string;
  channelLayout: string;
}

export interface FootageGraphInput {
  /** Input index of the main clip's video. */
  videoIn: number;
  /** The main audio pad (`0:a`, `2:a`), or null when the clip has none (silence is generated). */
  audioIn: string | null;
  keep?: KeepRange[];
  tonemap?: boolean;
  cutaways: ResolvedCutaway[];
  /** Output frame `W:H`; the main clip is framed to it before a cutaway composites over it. */
  scale: string;
  /** How the main clip is framed when cutaways need it at the output size. */
  frameFit: 'cover' | 'contain';
  audioFormat: FootageAudioFormat;
  /** The section's `-af` chain (effect, fades) without apad, folded into the graph; '' for none. */
  audioChain: string;
  /** Pad the clip's own audio with silence up to `length` (the -af apad of an unedited section). */
  padAudio: boolean;
  /** The edited section length when known: the audio leg is bounded to it. */
  length?: number;
  /** The section graph as built: the linear chain, or the complex graph and its final pad. */
  filtersList: string[];
  filtersMapList: string[];
  mapsList: string[];
}

function silence(format: FootageAudioFormat, seconds?: number): string {
  const trim = seconds === undefined ? '' : `,atrim=duration=${seconds}`;

  return `anullsrc=r=${format.sampleRate}:cl=${format.channelLayout}${trim}`;
}

// Kept windows: one trim/atrim leg per window, joined by a single concat (or used as-is for one window).
function keepLegs(input: FootageGraphInput, keep: KeepRange[]): Legs {
  const total = keep.reduce((sum, [from, to]) => sum + (to - from), 0);
  const withAudio = input.audioIn !== null;
  // One window feeds the edited legs directly; several get numbered legs and a concat.
  function label(i: number, kind: 'v' | 'a'): string {
    return keep.length === 1 ? `fk${kind}` : `fk${i}${kind}`;
  }

  const nodes = keep.flatMap(([from, to], i) => [
    `[${input.videoIn}:v]trim=start=${from}:end=${to},setpts=PTS-STARTPTS[${label(i, 'v')}]`,
    ...(withAudio ? [`[${input.audioIn}]atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS[${label(i, 'a')}]`] : []),
  ]);

  if (keep.length > 1) {
    const pads = keep.map((_, i) => `[fk${i}v]${withAudio ? `[fk${i}a]` : ''}`).join('');
    nodes.push(`${pads}concat=n=${keep.length}:v=1:a=${withAudio ? 1 : 0}[fkv]${withAudio ? '[fka]' : ''}`);
  }

  if (!withAudio) nodes.push(`${silence(input.audioFormat, Number(total.toFixed(3)))}[fka]`);

  return { nodes, video: 'fkv', audio: 'fka' };
}

function sourceLegs(input: FootageGraphInput): Legs {
  if (input.keep && input.keep.length > 0) return keepLegs(input, input.keep);

  if (input.audioIn !== null) return { nodes: [], video: `${input.videoIn}:v`, audio: input.audioIn };

  return { nodes: [`${silence(input.audioFormat)}[fsil]`], video: `${input.videoIn}:v`, audio: 'fsil' };
}

// The section graph reading the edited video leg instead of the raw input: the linear chain becomes one
// node; a complex graph has its main-clip references re-pointed (split when it reads the clip twice).
function sectionNodes(input: FootageGraphInput, video: string): { nodes: string[]; pad: string } {
  if (input.filtersMapList.length === 0) {
    const chain = input.filtersList.length > 0 ? input.filtersList.join(',') : 'null';

    return { nodes: [`[${video}]${chain}[fvout]`], pad: 'fvout' };
  }

  const raw = `[${input.videoIn}:v]`;
  const uses = input.filtersMapList.join(';').split(raw).length - 1;

  if (uses === 0) {
    throw new Error('footage edits (keep/trimSilence/cutaways/HDR) need the section graph to read the main clip');
  }

  const labels = Array.from({ length: uses }, (_, i) => (uses === 1 ? `[${video}]` : `[fsv${i}]`));
  let next = 0;
  const graph = input.filtersMapList.join(';').replaceAll(raw, () => labels[next++]);
  const split = uses > 1 ? [`[${video}]split=${uses}${labels.join('')}`] : [];

  return { nodes: [...split, graph], pad: input.mapsList.at(-1) ?? '' };
}

function tonemapLeg(legs: Legs, tonemap: boolean | undefined): Legs {
  if (!tonemap) return legs;

  return { ...legs, nodes: [...legs.nodes, `[${legs.video}]${TONEMAP_CHAIN}[ftm]`], video: 'ftm' };
}

// The section's audio effect/fades, then the leg bounded to the section length. An unbounded audio
// leg (apad, or the infinite blank track) inside a complex graph never lets `-shortest` end the
// encode on FFmpeg 6.x, so padding is `apad=whole_dur` and the leg is cut with atrim.
function audioTail(legs: Legs, input: FootageGraphInput): Legs {
  const length = input.length;
  const bound =
    length === undefined ? [] : [...(input.padAudio ? [`apad=whole_dur=${length}`] : []), `atrim=duration=${length}`];
  const chain = [...(input.audioChain === '' ? [] : [input.audioChain]), ...bound].join(',');

  if (chain === '') return legs;

  return { ...legs, nodes: [...legs.nodes, `[${legs.audio}]${chain}[faout]`], audio: 'faout' };
}

/** True when the plan changes the section graph at all (so untouched sections stay byte-identical). */
export function hasFootageGraph(plan: { keep?: KeepRange[]; tonemap?: boolean; cutaways: unknown[] }): boolean {
  return Boolean(plan.keep?.length) || Boolean(plan.tonemap) || plan.cutaways.length > 0;
}

/** The `-filter_complex … -map [video] -map [audio]` arguments of a section with footage edits. */
export function footageFilterArgs(input: FootageGraphInput): string {
  const source = tonemapLeg(sourceLegs(input), input.tonemap);
  const withVideo = cutawayVideo(source, input);
  const withAudio = audioTail(cutawayAudio(withVideo, input), input);
  const section = sectionNodes(input, withAudio.video);
  const graph = [...withAudio.nodes, ...section.nodes].join(';');
  // An untouched input pad (`0:a`) is mapped as a stream specifier, a graph output as `[label]`.
  const audioMap = withAudio.audio.includes(':') ? withAudio.audio : `[${withAudio.audio}]`;

  return ` -filter_complex "${graph}" -map [${section.pad}] -map ${audioMap} `;
}
