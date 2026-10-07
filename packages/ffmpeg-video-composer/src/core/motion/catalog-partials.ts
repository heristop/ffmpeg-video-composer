// The partial vocabulary of the motion catalog: how an agent picks a partial for its rhetorical job and
// re-times it (envelope, duration, sync points, align), plus a summary of any partial registry — the
// partials a sample embeds (get_sample) or a catalog ships — without their section bodies.

import { PARTIAL_JOB_DESCRIPTIONS } from '../../schemas/partial.schemas';

export const PARTIAL_GUIDE = {
  jobs: PARTIAL_JOB_DESCRIPTIONS,
  definition: {
    envelope:
      '{ in, out }: seconds of fixed intro (entrances) and outro (exits). Only the hold between them stretches.',
    syncPoints: '[{ id, offset }]: named moments inside IN (offset ≤ envelope.in), exported as "cue:<id>".',
    jobs: 'The rhetorical jobs the partial does (see jobs); pick partials by job, not by look.',
    useWhen: 'One sentence: the situation it is right for.',
    avoidWhen: 'One sentence: the situation where it reads wrong.',
  },
  ref: {
    duration:
      'Total seconds for this use. IN keeps its times, OUT shifts by the extra; the section holding the end of the ' +
      'hold absorbs it. Shorter than in + out compresses both proportionally (motion warning partial_compressed).',
    align:
      '{ sync, to }: resize the section right before the ref so the sync point lands on "beat:n", "bar:n", ' +
      '"cue:name" of an earlier section, or seconds. Every earlier section needs options.duration.',
  },
  rules: [
    'Choose a partial for its job: one brand partial to open or close, one compare/ask card per question.',
    'Stretch with duration instead of editing the partial: its entrances and exits keep their timing.',
    'Land the partial on the music: align its sync point to a downbeat ("bar:5") rather than padding by hand.',
    'Inside the partial, time fields can reference the exported cue: "cue:logo + 0.2".',
  ],
  errors: [
    'partial_duration_unknown',
    'partial_envelope_invalid',
    'invalid_partial_ref',
    'align_unknown_sync',
    'align_unknown_cue',
    'align_unresolvable',
    'align_unreachable',
    'align_nested',
  ],
};

export interface PartialSummary {
  id: string;
  description?: string;
  jobs?: string[];
  useWhen?: string;
  avoidWhen?: string;
  envelope?: { in: number; out: number };
  syncPoints?: Array<{ id: string; offset: number }>;
  variables?: string[];
  /** Natural length in seconds, when every section declares options.duration. */
  duration?: number;
}

type PartialLike = {
  id: string;
  description?: string;
  jobs?: string[];
  useWhen?: string;
  avoidWhen?: string;
  envelope?: { in: number; out: number };
  syncPoints?: Array<{ id: string; offset: number }>;
  variables?: Record<string, string>;
  sections?: unknown[];
};

function naturalLength(sections: unknown[] | undefined): number | undefined {
  let total = 0;

  for (const section of sections ?? []) {
    const duration = (section as { options?: { duration?: unknown } }).options?.duration;

    if (typeof duration !== 'number') return undefined;
    total += duration;
  }

  return Number(total.toFixed(6));
}

/** Agent-facing summaries of a partial registry: what each is for and how it can be re-timed. */
export function partialCatalog(partials: readonly PartialLike[]): PartialSummary[] {
  return partials.map(({ sections, variables, ...meta }) => ({
    ...meta,
    ...(variables && { variables: Object.keys(variables) }),
    ...(naturalLength(sections) !== undefined && { duration: naturalLength(sections) }),
  }));
}
