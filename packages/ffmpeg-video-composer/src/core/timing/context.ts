// What the time-reference pass needs to know about the render: the output frame (a kinetic block wraps
// to it), the frame rate, and how a block's text resolves (it decides how many units stagger in). The
// director passes the real values; validation falls back to the template's own orientation and the first
// locale, which is enough to find unknown ids, cycles and negative times.

import DefaultConfig from '../default.config';
import type { TimingFrame } from './spans';

type Text = Record<string, string | undefined>;
type Placeholders = Record<string, string | string[] | undefined>;

export interface TimingOptions {
  /** Output scale "W:H" (default: the template orientation at 1280×720). */
  scale?: string;
  fps?: number;
  locale?: string;
  /** Form-field values substituted into `{{ field }}` placeholders. */
  fields?: Record<string, string>;
  /**
   * Validation: leave references that wait for `global.beats: { analyze: 'music' }` unresolved instead of
   * reporting the grid as unavailable (the Node compile measures it before resolving).
   */
  deferBeatsAnalysis?: boolean;
}

interface DescriptorView {
  global?: unknown;
}

interface GlobalView {
  orientation?: string;
  fps?: number;
  variables?: Placeholders;
  motion?: { energy?: number };
}

interface SectionView {
  options?: { upperCase?: boolean; lowerCase?: boolean };
}

function orientationScale(orientation: string | undefined): string {
  if (orientation === 'square') return DefaultConfig.SQUARE_SCALE;

  const [width, height] = DefaultConfig.SCALE.split(':');

  return orientation === 'portrait' ? `${height}:${width}` : DefaultConfig.SCALE;
}

/** The frame the template renders at. */
export function timingFrame(descriptor: DescriptorView, options: TimingOptions): TimingFrame {
  const global = (descriptor.global ?? {}) as GlobalView;
  const [width, height] = (options.scale ?? orientationScale(global.orientation)).split(':').map(Number);

  return { width, height, fps: options.fps ?? global.fps ?? DefaultConfig.FPS, energy: global.motion?.energy ?? 1 };
}

function substitute(text: string, placeholders: Placeholders | undefined): string {
  if (!placeholders) return text;

  return text.replaceAll(/\{\{ ([^{}]+) \}\}/g, (match, key: string) => {
    const value = placeholders[key];

    if (value === undefined) return match;

    return Array.isArray(value) ? value.join(', ') : value;
  });
}

/** The final copy of a block: locale pick, variables, form fields, then the section's case. */
export function timingText(
  descriptor: DescriptorView,
  section: SectionView,
  options: TimingOptions
): (text: Text) => string {
  const variables = ((descriptor.global ?? {}) as GlobalView).variables;

  return (text) => {
    const raw = text[options.locale ?? ''] ?? Object.values(text)[0] ?? '';
    const resolved = substitute(substitute(raw, variables), options.fields);

    if (section.options?.upperCase) return resolved.toUpperCase();

    return section.options?.lowerCase ? resolved.toLowerCase() : resolved;
  };
}
