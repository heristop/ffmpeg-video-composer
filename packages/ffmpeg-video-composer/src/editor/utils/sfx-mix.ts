// The sound-effect half of the final audio pass: one `-i` per distinct file, a chain per placement that
// trims, formats, sets the level and delays the sound to its start, and the amix that lays them over the
// bed (music + clip sound) with normalize=0 so a sound plays at its set level regardless of how many are
// mixed. The delay is `adelay`; on an engine whose allowlist lacks it, the same offset is built by
// concatenating a silent `anullsrc` lead. Pure.

import type { SfxPlacement } from './sfx-plan';

export interface SfxGraphInput {
  placements: readonly SfxPlacement[];
  /** Input index of the first sound-effect file (after the video and music inputs). */
  firstInput: number;
  /** The aformat every leg of the mix shares. */
  channelConfig: string;
  sampleRate: number;
  /** The engine's filter allowlist, null when every filter is present. */
  deviceFilters: ReadonlySet<string> | null;
}

export interface SfxGraph {
  /** `;`-terminated chains producing one label per placement. */
  graph: string;
  labels: string[];
}

/** The distinct files in first-use order: each becomes one `-i`. */
export function sfxFiles(placements: readonly SfxPlacement[]): string[] {
  return [...new Set(placements.map((placement) => placement.file))];
}

function fmt(value: number): string {
  return Number(value.toFixed(3)).toString();
}

// `[n:a]` once per placement, through asplit when a file plays more than once.
function sources(input: SfxGraphInput, files: readonly string[]): { split: string; labels: string[] } {
  const uses = files.map((file) => input.placements.filter((placement) => placement.file === file).length);
  const next = files.map(() => 0);
  const split = files
    .map((_, k) =>
      uses[k] > 1
        ? `[${input.firstInput + k}:a]asplit=${uses[k]}${Array.from({ length: uses[k] }, (_, j) => `[sfxin${k}_${j}]`).join('')}; `
        : ''
    )
    .join('');
  const labels = input.placements.map((placement) => {
    const k = files.indexOf(placement.file);
    const j = next[k]++;

    return uses[k] > 1 ? `sfxin${k}_${j}` : `${input.firstInput + k}:a`;
  });

  return { split, labels };
}

function delayed(chain: string, start: number, index: number, input: SfxGraphInput): string {
  const out = `[sfx${index}]`;

  if (start <= 0) return `${chain}${out}; `;

  const ms = Math.round(start * 1000);

  if (input.deviceFilters === null || input.deviceFilters.has('adelay')) return `${chain},adelay=${ms}|${ms}${out}; `;

  const lead = `sfxlead${index}`;

  return (
    `anullsrc=r=${input.sampleRate}:cl=stereo,atrim=duration=${fmt(start)},${input.channelConfig}[${lead}]; ` +
    `${chain}[sfxbody${index}]; [${lead}][sfxbody${index}]concat=n=2:v=0:a=1${out}; `
  );
}

/** The chains turning each placement into a positioned, levelled `[sfxN]`. */
export function sfxGraph(input: SfxGraphInput): SfxGraph {
  const files = sfxFiles(input.placements);
  const { split, labels } = sources(input, files);
  const chains = input.placements.map((placement, index) => {
    const trim = placement.trim > 0 ? `atrim=start=${fmt(placement.trim)},asetpts=PTS-STARTPTS,` : '';
    const chain = `[${labels[index]}]${trim}${input.channelConfig},volume=${fmt(placement.volume)}`;

    return delayed(chain, placement.start, index, input);
  });

  return { graph: `${split}${chains.join('')}`, labels: input.placements.map((_, index) => `sfx${index}`) };
}

/** Lays the sounds over `[bed]` (duration follows the bed) and ends in `[final]`. */
export function sfxOverBed(bed: string, sfx: SfxGraph, suffix: string): string {
  const inputs = [bed, ...sfx.labels].map((label) => `[${label}]`).join('');

  return `${sfx.graph}${inputs}amix=inputs=${sfx.labels.length + 1}:duration=first:normalize=0${suffix}[final]`;
}
