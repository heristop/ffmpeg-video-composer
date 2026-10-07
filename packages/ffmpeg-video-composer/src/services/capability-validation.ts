// `feature_unavailable`: the template asks for something the probed FFmpeg cannot render — text with no
// drawtext, a designed transition with no xfade, a LUT look with no lut3d, loudnorm without the filter.
// Advisory and pure: it needs a capability report (the Node probe, core/capabilities.ts) and is skipped
// without one. Features the probe could not settle ('unknown') are not reported.

import { featureOfFilter, type CapabilityFeature, type CapabilityReport } from '@/core/capabilities';
import { expandPartialsSafe } from '@/core/partials';
import { gradeToFilters, lookToFilters } from '../editor/presets/looks';
import type { ValidationError } from './validation/types';

type Bag = Record<string, unknown>;

interface FeatureUse {
  feature: CapabilityFeature;
  path: string;
  what: string;
}

const TEXT_SUGAR = ['caption', 'titleCard', 'lowerThird'] as const;

function bag(value: unknown): Bag {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};
}

function list(value: unknown): Bag[] {
  return Array.isArray(value) ? value.map(bag) : [];
}

function filterUses(section: Bag, path: string): FeatureUse[] {
  return list(section.filters).flatMap((filter, j) => {
    const type = typeof filter.type === 'string' ? filter.type : '';
    const feature = featureOfFilter(type);

    return feature ? [{ feature, path: `${path}.filters[${j}]`, what: `the ${type} filter` }] : [];
  });
}

function textUses(section: Bag, path: string): FeatureUse[] {
  const sugar = TEXT_SUGAR.filter((key) => section[key] !== undefined).map((key) => ({
    feature: 'drawtext' as const,
    path: `${path}.${key}`,
    what: `the ${key}`,
  }));
  const kinetic =
    list(section.kinetic).length > 0
      ? [{ feature: 'drawtext' as const, path: `${path}.kinetic`, what: 'kinetic text' }]
      : [];

  return [...sugar, ...kinetic];
}

function gradeUses(section: Bag, path: string): FeatureUse[] {
  const look = typeof section.look === 'string' ? lookToFilters(section.look) : [];
  const grade = section.grade ? gradeToFilters(section.grade) : [];

  return [
    ...look.map((filter) => ({ filter, path: `${path}.look`, what: `the "${String(section.look)}" look` })),
    ...grade.map((filter) => ({ filter, path: `${path}.grade`, what: 'the grade' })),
  ].flatMap(({ filter, ...use }) => {
    const feature = featureOfFilter(filter.type);

    return feature ? [{ feature, ...use }] : [];
  });
}

function transitionUse(transition: unknown, path: string): FeatureUse[] {
  const type = bag(transition).type;

  return typeof type === 'string' && type !== 'cut'
    ? [{ feature: 'xfade', path, what: `the "${type}" transition` }]
    : [];
}

function sectionUses(section: Bag, index: number): FeatureUse[] {
  const path = `sections[${index}]`;

  return [
    ...filterUses(section, path),
    ...textUses(section, path),
    ...gradeUses(section, path),
    ...transitionUse(section.transition, `${path}.transition`),
  ];
}

function globalUses(global: Bag): FeatureUse[] {
  const normalize = bag(global.audio).normalize === 'loudnorm';

  return [
    ...transitionUse(global.transition, 'global.transition'),
    ...(normalize
      ? [{ feature: 'loudnorm' as const, path: 'global.audio.normalize', what: 'loudnorm normalization' }]
      : []),
  ];
}

/** Every place the (partial-expanded) template relies on a probed feature. */
export function templateFeatureUses(template: unknown): FeatureUse[] {
  const expansion = expandPartialsSafe(template);
  const descriptor = bag(expansion.ok ? expansion.data : template);

  return [...globalUses(bag(descriptor.global)), ...list(descriptor.sections).flatMap(sectionUses)];
}

/**
 * `feature_unavailable` advisories for the features the template uses that `capabilities` says this
 * FFmpeg cannot run, one per path and feature. Paths index the partial-expanded sections.
 */
export function capabilityFindings(template: unknown, capabilities: CapabilityReport): ValidationError[] {
  const seen = new Set<string>();

  return templateFeatureUses(template).flatMap((use) => {
    const status = capabilities.features[use.feature];
    const key = `${use.path}\n${use.feature}`;

    if (status.usable !== 'no' || seen.has(key)) return [];

    seen.add(key);

    return [
      {
        path: use.path,
        code: 'feature_unavailable',
        message: `${use.what} needs ${use.feature}, which the FFmpeg at ${capabilities.ffmpeg.path} cannot run (${status.detail})`,
        ...(status.fix && { hint: status.fix }),
      },
    ];
  });
}
