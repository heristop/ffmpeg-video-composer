// Descriptor rules for the recorded-footage vocabulary (look strength, grade.lut, trimSilence, keep,
// cutaways), plus the advisory that silence trimming only runs where the Node analysis does.
//
// - look_strength_unsupported: `strength` on a look that is not LUT-backed (it has no cube to blend).
// - keep_and_trim_silence: both the explicit windows and the analysis on one section.
// - trim_silence_noop: `edges: false` without `gaps` cuts nothing.
// - keep_range_invalid: a window that ends before it starts, or windows out of order / overlapping.
// - cutaway_overlap: cutaways out of order or overlapping (one B-roll clip at a time).
// - cutaway_out_of_range: a cutaway that runs past the section's known length.
// - take_edit_combination: keep / trimSilence / cutaways together with clip / speedRamp / freeze. The take
//   edits run on the raw clip ahead of the section chain, the clip/ramp/freeze edits inside it, so their
//   timelines would disagree; one family per section.

import { LUT_LOOK_PRESETS } from '../schemas/effects.schemas';
import type { Section, TemplateDescriptor } from '../schemas/template.schemas';
import { knownDuration } from '@/core/timing/timeline';
import type { ValidationError } from './validation/types';

const LUT_LOOKS = new Set<string>(LUT_LOOK_PRESETS);

function lookStrengthErrors(look: unknown, path: string): ValidationError[] {
  if (typeof look !== 'object' || look === null) return [];

  const { preset, strength } = look as { preset: string; strength?: number };

  if (strength === undefined || strength === 1 || LUT_LOOKS.has(preset)) return [];

  return [
    {
      path: `${path}.strength`,
      message: `look "${preset}" is not LUT-backed, so it has no strength to dial`,
      code: 'look_strength_unsupported',
      hint: `Drop strength (use "${preset}" at full strength), or pick a LUT look: ${LUT_LOOK_PRESETS.join(', ')}.`,
      suggestion: preset,
      kind: 'judgement',
    },
  ];
}

function keepErrors(keep: Array<[number, number]>, path: string): ValidationError[] {
  return keep.flatMap(([from, to], j): ValidationError[] => {
    const previous = keep.at(j - 1);
    const overlaps = j > 0 && previous !== undefined && from < previous[1];

    if (to > from && !overlaps) return [];

    return [
      {
        path: `${path}[${j}]`,
        message:
          to > from ? `keep window ${j} starts before window ${j - 1} ends` : `keep window ${j} ends before it starts`,
        code: 'keep_range_invalid',
        hint: 'List keep windows as [from, to] with from < to, ascending and non-overlapping.',
        kind: 'judgement',
      },
    ];
  });
}

function trimErrors(section: Section, path: string): ValidationError[] {
  const options = section.options as { trimSilence?: { edges?: boolean; gaps?: unknown }; keep?: unknown } | undefined;
  const trim = options?.trimSilence;

  if (trim && options.keep !== undefined) {
    const message = `Section "${section.name}": options.keep and options.trimSilence both cut the take`;
    const hint = 'Keep one: explicit windows (keep) or the silence analysis (trimSilence).';

    return [{ path: `${path}.options.trimSilence`, message, code: 'keep_and_trim_silence', hint, kind: 'judgement' }];
  }

  if (trim?.edges === false && trim.gaps === undefined) {
    const message = `Section "${section.name}": trimSilence with edges false and no gaps cuts nothing`;

    return [
      { path: `${path}.options.trimSilence`, message, code: 'trim_silence_noop', kind: 'format', suggestion: {} },
    ];
  }

  return [];
}

type CutawayLike = { at: number | string; duration: number };

function cutawayErrors(section: Section, path: string): ValidationError[] {
  const cutaways = ((section as { cutaways?: CutawayLike[] }).cutaways ?? []).filter((c) => typeof c.at === 'number');
  const length = knownDuration(section);

  return cutaways.flatMap((cutaway, j): ValidationError[] => {
    const at = cutaway.at as number;
    const previous = cutaways.at(j - 1);
    const end = at + cutaway.duration;
    const base = `${path}.cutaways[${j}]`;

    if (j > 0 && previous && at < (previous.at as number) + previous.duration) {
      const message = `Section "${section.name}": cutaway ${j} starts before the previous one ends`;
      const hint = 'Order cutaways by `at` and leave each one to end before the next starts.';

      return [{ path: `${base}.at`, message, code: 'cutaway_overlap', hint, kind: 'judgement' }];
    }

    if (length !== undefined && end > length + 1e-6) {
      const message = `Section "${section.name}": cutaway ${j} ends at ${end}s, past the section's ${length}s`;

      return [
        {
          path: `${base}.duration`,
          message,
          code: 'cutaway_out_of_range',
          suggestion: Math.max(0.1, length - at),
          kind: 'judgement',
        },
      ];
    }

    return [];
  });
}

const TIME_EDITS = ['clip', 'speedRamp', 'freeze'] as const;

function combinationErrors(section: Section, path: string): ValidationError[] {
  const options = section.options as Record<string, unknown> | undefined;
  const take = ['keep', 'trimSilence'].filter((key) => options?.[key] !== undefined);
  const cutaways = ((section as { cutaways?: unknown[] }).cutaways ?? []).length > 0 ? ['cutaways'] : [];
  const time = TIME_EDITS.filter((key) => options?.[key] !== undefined);
  const takeEdits = [...take, ...cutaways];

  if (takeEdits.length === 0 || time.length === 0) return [];

  return [
    {
      path: `${path}.options.${time[0]}`,
      message: `Section "${section.name}": ${takeEdits.join('/')} cannot be combined with ${time.join('/')}`,
      code: 'take_edit_combination',
      hint: 'Cut the take with keep/trimSilence (and cutaways) OR retime it with clip/speedRamp/freeze, not both.',
      kind: 'judgement',
    },
  ];
}

function sectionErrors(section: Section, index: number): ValidationError[] {
  const path = `sections[${index}]`;
  const keep = (section.options as { keep?: Array<[number, number]> } | undefined)?.keep;

  return [
    ...lookStrengthErrors(section.look, `${path}.look`),
    ...trimErrors(section, path),
    ...(keep ? keepErrors(keep, `${path}.options.keep`) : []),
    ...cutawayErrors(section, path),
    ...combinationErrors(section, path),
  ];
}

export function validateTakeEdits(template: TemplateDescriptor): ValidationError[] {
  return [
    ...lookStrengthErrors(template.global?.look, 'global.look'),
    ...(template.sections ?? []).flatMap((section, index) => sectionErrors(section, index)),
  ];
}

/** Advisory: silence trimming runs on the Node engine only (the analysis needs silencedetect). */
export function takeAdvisories(template: TemplateDescriptor): Array<{
  path: string;
  code: string;
  message: string;
  severity: 'info';
  hint: string;
}> {
  return (template.sections ?? []).flatMap((section, index) =>
    (section.options as { trimSilence?: unknown } | undefined)?.trimSilence === undefined
      ? []
      : [
          {
            path: `sections[${index}].options.trimSilence`,
            code: 'trim_silence_host_only',
            message: `Section "${section.name}": trimSilence is analysed on the Node engine only`,
            severity: 'info' as const,
            hint: 'Browser and on-device renders keep the take untrimmed; pass precomputed windows as options.keep there.',
          },
        ]
  );
}
