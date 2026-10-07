// Per-ref timing of a partial: the ref `duration` (elastic envelope, core/partial-envelope.ts), the
// export of the partial's sync points as section cues, and where an `align` sync point sits so the
// align pass (core/partial-align.ts) can land it once the whole template is expanded. Pure.

import {
  PartialEnvelopeSchema,
  PartialRefTimingSchema,
  SyncPointSchema,
  type PartialAlign,
  type PartialEnvelope,
  type SyncPoint,
} from '../schemas/partial.schemas';
import { nearestName } from './timing/grammar';
import { applyEnvelope, exportSyncCues, locate, partialStarts } from './partial-envelope';
import { PartialError } from './partial-error';

type Bag = Record<string, unknown>;

export interface PartialFinding {
  path: string;
  code: string;
  message: string;
  hint?: string;
}

export interface TimedPartial {
  sections: Bag[];
  warnings: PartialFinding[];
  /** Set when the ref aligns: the sync point's section (index into `sections`) and local offset. */
  align?: { align: PartialAlign; syncIndex: number; syncOffset: number };
}

interface PartialMeta {
  envelope?: PartialEnvelope;
  syncPoints: SyncPoint[];
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

// Malformed metadata is the schema's to report (descriptor.partials is validated after expansion); here
// it simply does not take part.
function partialMeta(partial: Bag | undefined): PartialMeta {
  const envelope = PartialEnvelopeSchema.safeParse(partial?.envelope);
  const points = Array.isArray(partial?.syncPoints) ? partial.syncPoints : [];

  return {
    envelope: envelope.success ? envelope.data : undefined,
    syncPoints: points.flatMap((point) => {
      const parsed = SyncPointSchema.safeParse(point);

      return parsed.success ? [parsed.data] : [];
    }),
  };
}

function refTiming(ref: Bag, path: string): { duration?: number; align?: PartialAlign } {
  const parsed = PartialRefTimingSchema.safeParse({ duration: ref.duration, align: ref.align });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];

    throw new PartialError(`${path}.${issue.path.join('.')}`, 'invalid_partial_ref', issue.message);
  }

  return parsed.data;
}

function stretch(sections: Bag[], meta: PartialMeta, duration: number, path: string) {
  const { starts, complete } = partialStarts(sections);

  if (!complete) {
    throw new PartialError(
      `${path}.duration`,
      'partial_duration_unknown',
      'duration needs every section of the partial to have options.duration (a project_video length is only probed)',
      'set options.duration on the partial sections, or drop duration from the ref'
    );
  }

  const natural = starts.at(-1) ?? 0;
  const envelope = meta.envelope;

  if (envelope && envelope.in + envelope.out > natural + 1e-6) {
    throw new PartialError(
      `${path}.duration`,
      'partial_envelope_invalid',
      `the partial envelope (in ${envelope.in}s + out ${envelope.out}s) is longer than the partial (${round(natural)}s)`,
      'fix the envelope of the partial definition'
    );
  }

  return applyEnvelope(sections, starts, envelope, duration);
}

function compressedWarning(path: string, duration: number, envelope: PartialEnvelope | undefined, natural: number) {
  const span = envelope ? envelope.in + envelope.out : natural;

  return {
    path: `${path}.duration`,
    code: 'partial_compressed',
    message: `duration ${duration}s is shorter than the partial's fixed motion (${round(span)}s): its intro and outro play faster`,
    hint: `give the ref at least ${round(span)}s, or pick a shorter partial`,
  };
}

function syncTarget(sections: Bag[], points: SyncPoint[], align: PartialAlign, path: string) {
  const point = points.find((candidate) => candidate.id === align.sync);

  if (!point) {
    const near = nearestName(
      align.sync,
      points.map((candidate) => candidate.id)
    );

    throw new PartialError(
      `${path}.align.sync`,
      'align_unknown_sync',
      `the partial has no sync point "${align.sync}"`,
      near ? `did you mean "${near}"?` : 'declare it in the partial syncPoints'
    );
  }

  const { starts, complete } = partialStarts(sections);

  if (!complete && point.offset >= (starts.at(-1) ?? 0)) {
    throw new PartialError(
      `${path}.align`,
      'align_unresolvable',
      `the sync point "${point.id}" sits after a section of unknown length`
    );
  }

  const { index, offset } = locate(starts, point.offset);

  return { align, syncIndex: index, syncOffset: offset };
}

/**
 * Applies the ref's `duration` and exports the sync cues on the (variable-substituted) partial sections.
 * Refs without `duration`/`align` to a partial without sync points come back untouched (same objects).
 */
export function timePartial(sourceSections: unknown[], partial: Bag | undefined, ref: Bag, path: string): TimedPartial {
  const timing = refTiming(ref, path);
  const meta = partialMeta(partial);
  let sections = sourceSections as Bag[];
  let points = meta.syncPoints;
  const warnings: PartialFinding[] = [];

  if (timing.duration !== undefined) {
    const result = stretch(sections, meta, timing.duration, path);

    sections = result.sections;
    points = points.map((point) => ({ ...point, offset: round(result.map(point.offset)) }));

    if (result.compressed) warnings.push(compressedWarning(path, timing.duration, meta.envelope, result.natural));
  }

  if (points.length > 0) sections = exportSyncCues(sections, partialStarts(sections).starts, points);

  const align = timing.align ? syncTarget(sections, points, timing.align, path) : undefined;

  return { sections, warnings, ...(align && { align }) };
}
