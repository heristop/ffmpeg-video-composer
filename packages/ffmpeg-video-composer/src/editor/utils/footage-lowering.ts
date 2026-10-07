// Lowers a footage plan (core/footage/plan.ts) to FFmpeg. Video: a head of the section chain, run on the
// raw clip before any reframing or sugar: trim → setpts (restart) → setpts ramp expression → fps
// conform → loop (one per freeze) → setpts frame-index restamp. Audio: the same source pieces through
// atrim + atempo chains (each atempo kept inside 0.5..2), silence parts from aevalsrc for freezes, joined
// by one concat, as a prefix of the section's `-af` chain. Every filter is on the on-device allowlist
// (no tpad/apad/adelay), and nothing reads the wall clock: the same plan always lowers to the same graph.

import type { Filter, FilterValues } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { rampTimeOf, sourceAt, type FootagePlan, type RampPiece } from '@/core/footage/plan';

type AudioPart =
  | { kind: 'source'; s0: number; s1: number | undefined; speed: number }
  | { kind: 'silence'; seconds: number };

export interface AudioFormat {
  sampleRate: number;
  channelLayout: string;
}

function setpts(expr: string): Filter {
  // FormatterManager rewrites a `setpts` *value* to the section speed, so the expression rides in `values`.
  return { type: 'setpts', values: { expr } as unknown as FilterValues };
}

function trims(plan: FootagePlan): string[] {
  return [
    ...(plan.from > 0 ? [`start=${fmt(plan.from)}`] : []),
    ...(plan.to === undefined ? [] : [`end=${fmt(plan.to)}`]),
  ];
}

function pieceExpr(piece: RampPiece): string {
  const local = piece.s0 === 0 ? 'T' : `(T-${fmt(piece.s0)})`;
  const scaled = piece.speed === 1 ? local : `${local}/${fmt(piece.speed)}`;

  return piece.o0 === 0 ? scaled : `${fmt(piece.o0)}+${scaled}`;
}

/** Output seconds as a function of source time `T`: one nested `if` per piece boundary. */
export function rampExpr(pieces: readonly RampPiece[]): string {
  let expr = pieceExpr(pieces.at(-1) as RampPiece);

  for (let index = pieces.length - 2; index >= 0; index--) {
    expr = `if(lt(T,${fmt(pieces[index + 1].s0)}),${pieceExpr(pieces[index])},${expr})`;
  }

  return expr;
}

/** The video head of the section chain for a footage plan (empty when nothing is edited). */
export function footageVideoFilters(plan: FootagePlan, fps: number): Filter[] {
  const trim = trims(plan);
  const filters: Filter[] = trim.length > 0 ? [{ type: 'trim', value: trim.join(':') }] : [];

  if (trim.length > 0 || plan.pieces) filters.push(setpts('PTS-STARTPTS'));

  if (plan.pieces) filters.push(setpts(`'(${rampExpr(plan.pieces)})/TB'`));

  if (plan.pieces || plan.freezes.length > 0) filters.push({ type: 'fps', value: fps });

  for (const freeze of plan.freezes) {
    filters.push({ type: 'loop', value: `loop=${freeze.frames}:size=1:start=${freeze.frame}` });
  }

  if (plan.freezes.length > 0) filters.push(setpts(`N/(${fps}*TB)`));

  return filters;
}

type SourcePart = Extract<AudioPart, { kind: 'source' }>;

// Where piece `index` stops playing source: the next piece, capped at the trimmed span.
function pieceEnd(pieces: readonly RampPiece[], index: number, span: number | undefined): number | undefined {
  const next = index + 1 < pieces.length ? pieces[index + 1].s0 : undefined;

  if (span === undefined) return next;

  return next === undefined ? span : Math.min(next, span);
}

function sourceParts(plan: FootagePlan): SourcePart[] {
  const pieces = plan.pieces ?? [{ o0: 0, s0: 0, speed: 1 }];
  const span = plan.span;

  return pieces
    .map((piece, index): SourcePart => ({
      kind: 'source',
      s0: piece.s0,
      s1: pieceEnd(pieces, index, span),
      speed: piece.speed,
    }))
    .filter((part) => span === undefined || part.s0 < span);
}

// Splits the source part playing at source time `at` and puts `silence` between the halves.
function insertSilence(parts: AudioPart[], at: number, seconds: number): AudioPart[] {
  const index = parts.findIndex((part) => part.kind === 'source' && at < (part.s1 ?? Infinity));
  const part = index === -1 ? undefined : parts[index];

  if (part?.kind !== 'source') return [...parts, { kind: 'silence', seconds }];

  const silence: AudioPart = { kind: 'silence', seconds };

  if (at <= part.s0) return [...parts.slice(0, index), silence, ...parts.slice(index)];

  const head: AudioPart = { ...part, s1: at };
  const tail: AudioPart = { ...part, s0: at };

  return [...parts.slice(0, index), head, silence, tail, ...parts.slice(index + 1)];
}

/** Audio parts in output order: ramp pieces, with a silence wherever a freeze pauses the sound. */
export function audioParts(plan: FootagePlan, fps: number): AudioPart[] {
  let parts: AudioPart[] = sourceParts(plan);
  const trailing: AudioPart[] = [];

  for (const freeze of plan.freezes) {
    const seconds = freeze.frames / fps;

    if (freeze.audio === 'continue') {
      trailing.push({ kind: 'silence', seconds });
      continue;
    }

    const rampTime = rampTimeOf(freeze.frame / fps, plan.freezes, fps);
    parts = insertSilence(parts, plan.pieces ? sourceAt(plan.pieces, rampTime) : rampTime, seconds);
  }

  return [...parts, ...trailing];
}

/** atempo factors multiplying to `speed`, each inside atempo's portable 0.5..2 range. */
export function atempoChain(speed: number): string[] {
  const factors: string[] = [];
  let rest = speed;

  while (rest > 2) {
    factors.push('atempo=2');
    rest /= 2;
  }

  while (rest < 0.5) {
    factors.push('atempo=0.5');
    rest /= 0.5;
  }

  if (Number(fmt(rest)) !== 1) factors.push(`atempo=${fmt(rest)}`);

  return factors;
}

function sourceChain(part: SourcePart, from: number, mute: boolean): string {
  const end = part.s1 === undefined ? '' : `:end=${fmt(from + part.s1)}`;
  const tempo = atempoChain(part.speed);
  const silenced = mute && part.speed !== 1 ? ['volume=0'] : [];

  return [`atrim=start=${fmt(from + part.s0)}${end}`, 'asetpts=PTS-STARTPTS', ...tempo, ...silenced].join(',');
}

function silenceSource(seconds: number, format: AudioFormat): string {
  return `aevalsrc=0:d=${fmt(seconds)}:s=${format.sampleRate}:c=${format.channelLayout}`;
}

/**
 * The `-af` prefix for a footage plan: one filtergraph string (labelled pads joined by `;`, ending on an
 * unlabelled concat output so the section's own effects and fades chain after it with a comma).
 */
export function footageAudioChain(
  plan: FootagePlan,
  fps: number,
  format: AudioFormat,
  options: { rampAudio?: 'stretch' | 'mute' }
): string[] {
  const parts = audioParts(plan, fps);
  const mute = options.rampAudio === 'mute';
  const sources = parts.filter((part): part is SourcePart => part.kind === 'source');

  if (parts.length === 1 && sources.length === 1) return [sourceChain(sources[0], plan.from, mute)];

  // Always split (even into one leg) so the graph's single unlabelled input is its first filter.
  const split = `asplit=${sources.length}${sources.map((_, i) => `[fa${i}]`).join('')};`;
  const labels: string[] = [];
  const chains: string[] = [];

  for (const part of parts) {
    const label = `fp${labels.length}`;
    labels.push(`[${label}]`);

    if (part.kind === 'silence') {
      chains.push(`${silenceSource(part.seconds, format)}[${label}]`);
      continue;
    }

    chains.push(`[fa${sources.indexOf(part)}]${sourceChain(part, plan.from, mute)}[${label}]`);
  }

  return [`${split}${chains.join(';')};${labels.join('')}concat=n=${parts.length}:v=0:a=1`];
}
