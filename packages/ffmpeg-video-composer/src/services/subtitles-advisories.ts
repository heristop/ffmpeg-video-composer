// Advisory findings for word-timed subtitles, on the motion-warnings channel (never errors):
//
// - caption_split (info): a cue did not fit maxLines at minSize and renders as several consecutive cues.
// - caption_shrunk (info): a cue renders below the track's size to fit.
// - subtitle_past_end (warn): a cue or word runs past the section's declared duration.
// - caption_crown_repeated (warn): more than one section crowns a line; the payoff lands once per video.
//
// The plan is the lowering's own (core/captions/plan.ts), laid out at the descriptor's canvas, so what is
// reported is what renders. Copy resolves in the first locale with the descriptor's variables.

import { expandPartialsSafe } from '@/core/partials';
import { effectiveOrientation } from '@/core/platforms';
import { planSubtitles } from '@/core/captions/plan';
import { timedCues } from '@/core/captions/cues';
import { resolveTimeRefs } from '@/core/timing/resolve';
import type { Subtitles } from '../schemas/subtitles.schemas';
import { canvasFor } from './geometry/canvas';
import type { MotionWarning } from './motion-lint';

interface LooseSection {
  name?: string;
  options?: { duration?: number; upperCase?: boolean; lowerCase?: boolean };
  subtitles?: Subtitles;
}

interface LooseTemplate {
  global?: { orientation?: string; platform?: string; variables?: Record<string, unknown> };
  sections?: LooseSection[];
}

const PAST_END_TOLERANCE = 0.05;

function textResolver(variables: Record<string, unknown> | undefined) {
  return (text: Record<string, string | undefined>): string => {
    const raw = Object.values(text).find((value) => typeof value === 'string') ?? '';

    return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (placeholder: string, key: string) => {
      const value = variables?.[key];

      return typeof value === 'string' || typeof value === 'number' ? String(value) : placeholder;
    });
  };
}

function sectionCase(section: LooseSection, text: string): string {
  if (section.options?.upperCase) return text.toUpperCase();

  return section.options?.lowerCase ? text.toLowerCase() : text;
}

function pastEnd(section: LooseSection, subtitles: Subtitles, path: string, resolve: ReturnType<typeof textResolver>) {
  const duration = section.options?.duration;

  if (duration === undefined) return [];

  const last = Math.max(0, ...timedCues(subtitles, resolve).flatMap((cue) => cue.words.map((word) => word.end)));

  if (last <= duration + PAST_END_TOLERANCE) return [];

  const warning: MotionWarning = {
    path,
    code: 'subtitle_past_end',
    message: `Section "${section.name}": subtitles run to ${Number(last.toFixed(2))}s, past the section end (${duration}s); the overflow is cut`,
    severity: 'warn',
    hint: 'Trim the cues, lengthen options.duration, or shift the track with subtitles.offset.',
  };

  return [warning];
}

function sectionAdvisories(template: LooseTemplate, section: LooseSection, index: number): MotionWarning[] {
  const subtitles = section.subtitles;

  if (!subtitles) return [];

  const path = `sections[${index}].subtitles`;
  const resolve = textResolver(template.global?.variables);
  const plan = planSubtitles(subtitles, {
    frame: canvasFor(effectiveOrientation(template.global)),
    platform: template.global?.platform,
    resolveText: resolve,
    sectionCase: (text) => sectionCase(section, text),
  });
  const layout = (plan?.advisories ?? []).map((advisory): MotionWarning => ({
    path,
    code: advisory.code,
    message: `Section "${section.name}": ${advisory.message}`,
    severity: 'info',
    hint:
      advisory.code === 'caption_split'
        ? 'Fine to keep; or tighten group.maxWords, lower minSize, or allow maxLines 3.'
        : 'Fine to keep; or shorten the cue or tighten group.maxWords.',
  }));

  return [...pastEnd(section, subtitles, path, resolve), ...layout];
}

function crownRepeats(sections: readonly LooseSection[]): MotionWarning[] {
  const crowned = sections.flatMap((section, index) => (section.subtitles?.crown === undefined ? [] : [index]));

  return crowned.slice(1).map((index) => ({
    path: `sections[${index}].subtitles.crown`,
    code: 'caption_crown_repeated',
    message: `${crowned.length} sections crown a caption line; a payoff lands once per video`,
    severity: 'warn',
    hint: 'Keep crown on the one section that carries the payoff.',
  }));
}

/** Subtitle advisories for an unvalidated descriptor. Never throws. */
export function subtitleAdvisories(template: unknown): MotionWarning[] {
  const expansion = expandPartialsSafe(template);

  if (!expansion.ok || expansion.data === null || typeof expansion.data !== 'object') return [];

  try {
    const resolved = resolveTimeRefs(expansion.data as LooseTemplate).descriptor;
    const sections = Array.isArray(resolved.sections) ? resolved.sections : [];

    return [
      ...sections.flatMap((section, index) => sectionAdvisories(resolved, section, index)),
      ...crownRepeats(sections),
    ];
  } catch {
    return [];
  }
}
