// Pure filtergraph builders for the xfade/acrossfade transition assembly. Extracted from VideoEditor
// so the (stateless) timeline math — offsets, capped durations, the xfade/acrossfade chains — is
// testable on its own and VideoEditor stays focused on orchestration. No FFmpeg or IO here.

import { designedTransitionGraph, isDesignedTransition } from '@/core/motion/transitions';
import type { EasingSpec } from '@/core/motion/easing';

/** A boundary transition between two adjacent segments — `type` is an xfade name, `cut` or a designed one. */
export type Transition = { type: string; duration: number; ease?: EasingSpec };

/** Per-segment probe result the assembly graph is built from. */
export type SegmentProbe = { duration: number; hasAudio: boolean };

// FFmpeg accepts decimals; trim float noise (4.499999) to keep commands clean and assertable.
export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Output geometry designed transitions need to compose frames (VideoEditor passes the project's). */
export type TransitionFrame = { scale: string; fps: number };

/**
 * xfade requires all inputs to share one resolution/SAR, and segments can disagree (forceAspectRatio
 * sections, mixed sources). Scale-and-pad every segment to the project scale before the xfade chain.
 */
export function buildNormalizeGraph(segmentCount: number, scale: string, commonTimebase = false): string {
  const links: string[] = [];
  // Designed transitions compose through concat/zoompan, which pick their own timebase; every segment
  // then joins on AVTB so the xfade chain never sees a mismatch. Off otherwise: historical commands.
  const timebase = commonTimebase ? ',settb=AVTB' : '';

  for (let k = 0; k < segmentCount; k++) {
    links.push(
      `[${k}:v]scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2,setsar=1${timebase}[vs${k}]`
    );
  }

  return links.join(';');
}

/**
 * offset_k = (Σ_{i≤k} d_i) − (Σ_{i≤k} effTr_i). The cumulative subtraction of prior transition
 * durations keeps every clip starting where the previous cross-dissolve ends, so later boundaries
 * don't drift.
 */
export function computeOffsets(probes: SegmentProbe[], effectiveDurations: number[]): number[] {
  const offsets: number[] = [];
  let durationSum = 0;
  let transitionSum = 0;

  for (let k = 0; k < effectiveDurations.length; k++) {
    durationSum += probes[k].duration;
    transitionSum += effectiveDurations[k];
    offsets.push(round(durationSum - transitionSum));
  }

  return offsets;
}

/**
 * Per-boundary transition duration fed to xfade/acrossfade. A `cut` has no overlap: it is joined with
 * `concat` (an xfade shorter than one frame ends the output early on FFmpeg 6.x). Every other transition is capped to at most HALF the shorter adjacent segment: an
 * xfade overlaps both neighbours, so a transition as long as a clip collapses the cumulative offset
 * to ≤0 and the whole timeline folds into one clip (the xfade-short-segment-collapse). Capping to half
 * keeps each clip ≥50% non-overlap so offsets stay strictly increasing. Normal multi-second clips pass
 * through unchanged.
 */
export function effectiveDurations(transitions: Transition[], probes: SegmentProbe[]): number[] {
  return transitions.map((transition, k) => {
    if (transition.type === 'cut') {
      return 0;
    }

    return round(Math.min(transition.duration, Math.min(probes[k].duration, probes[k + 1].duration) / 2));
  });
}

function strip(label: string): string {
  return label.replace(/^\[|\]$/g, '');
}

// One boundary: a built-in xfade, or a designed transition's per-frame composite (core/motion/transitions.ts).
function boundaryLink(
  transition: Transition,
  labels: { left: string; right: string; out: string; k: number },
  timing: { offset: number; duration: number },
  frame: TransitionFrame | undefined
): string {
  if (frame && isDesignedTransition(transition.type)) {
    const [width, height] = frame.scale.split(':').map(Number);

    return designedTransitionGraph({
      type: transition.type,
      ease: transition.ease,
      left: strip(labels.left),
      right: strip(labels.right),
      out: strip(labels.out),
      id: `dt${labels.k}`,
      ...timing,
      width,
      height,
      fps: frame.fps,
    });
  }

  if (transition.type === 'cut') {
    return `${labels.left}${labels.right}concat=n=2:v=1:a=0${labels.out}`;
  }

  return `${labels.left}${labels.right}xfade=transition=${transition.type}:duration=${timing.duration}:offset=${timing.offset}${labels.out}`;
}

export function buildVideoGraph(
  transitions: Transition[],
  offsets: number[],
  effectiveDurationsList: number[],
  finalLabel = '[vout]',
  frame?: TransitionFrame
): string {
  const links: string[] = [];

  for (let k = 0; k < transitions.length; k++) {
    const left = k === 0 ? '[vs0]' : `[v${k - 1}]`;
    const out = k === transitions.length - 1 ? finalLabel : `[v${k}]`;
    const timing = { offset: offsets[k], duration: effectiveDurationsList[k] };

    links.push(boundaryLink(transitions[k], { left, right: `[vs${k + 1}]`, out, k }, timing, frame));
  }

  return links.join(';');
}

export function buildAudioGraph(
  transitions: Transition[],
  audioInputIndex: number[],
  effectiveDurationsList: number[]
): string {
  const links: string[] = [];

  for (let k = 0; k < transitions.length; k++) {
    const left = k === 0 ? `[${audioInputIndex[0]}:a]` : `[a${k - 1}]`;
    const out = k === transitions.length - 1 ? '[aout]' : `[a${k}]`;

    const right = `[${audioInputIndex[k + 1]}:a]`;
    const join =
      transitions[k].type === 'cut' ? 'concat=n=2:v=0:a=1' : `acrossfade=d=${effectiveDurationsList[k]}:c1=tri:c2=tri`;

    links.push(`${left}${right}${join}${out}`);
  }

  return links.join(';');
}
