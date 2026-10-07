// `global.audio.sfx: "auto"`: sound effects derived from the motion the template already declares, added
// to each section's `sfx` before rendering. A whoosh where a designed transition starts (section time 0 of
// the incoming section, where the overlap begins), a hit where a kinetic `impact` block lands and on every
// camera hit, a riser ending on every `drop` cue. Runs after the time-reference pass, so every time is
// seconds. Deterministic: document order, then time; capped; a cue landing (same edge) near an authored
// sound or an earlier auto cue is skipped so effects never stack. Pure.

import { isDesignedTransition } from '../motion/transitions';
import type { ElementEntry } from '../timing/fields';
import { entranceSpan, defaultStart, type SpanContext } from '../timing/spans';
import { knownDuration, RENDERED, type TimelineSection } from '../timing/timeline';
import { timingFrame, timingText, type TimingOptions } from '../timing/context';
import { sfxEntry, type SfxId } from './sfx-library';

type Bag = Record<string, unknown>;

interface AutoCue {
  id: SfxId;
  at: number;
}

/** At most this many auto sounds in the whole video. */
export const AUTO_SFX_CAP = 12;
/** Seconds within which a second sound is skipped (an authored one always wins). */
export const AUTO_SFX_SPACING = 0.15;

function round(value: number): number {
  return Number(value.toFixed(6));
}

// Where each `impact` kinetic block has landed: its start plus its entrance span (last unit arrived).
function impactLands(section: Bag, ctx: SpanContext): AutoCue[] {
  const blocks = Array.isArray(section.kinetic) ? (section.kinetic as Bag[]) : [];

  return blocks
    .filter((node) => node.preset === 'impact')
    .flatMap((node) => {
      const entry: ElementEntry = { id: '', kind: 'kinetic', path: '', start: node.delay, node };
      const start = typeof node.delay === 'number' ? node.delay : defaultStart(entry);

      try {
        return [{ id: 'hit' as const, at: round(start + entranceSpan(entry, ctx)) }];
      } catch {
        return [];
      }
    });
}

function cameraHits(section: Bag): AutoCue[] {
  const hits = ((section.camera as Bag | undefined)?.hits ?? []) as unknown[];

  return hits.flatMap((hit) => {
    const at = typeof hit === 'number' ? hit : (hit as Bag | null)?.at;

    return typeof at === 'number' ? [{ id: 'hit' as const, at }] : [];
  });
}

function dropRisers(section: Bag): AutoCue[] {
  const drop = (section.cues as Record<string, number> | undefined)?.drop;

  return typeof drop === 'number' ? [{ id: 'riser', at: drop }] : [];
}

function transitionType(previous: Bag | undefined, global: Bag): string | undefined {
  const declared = (previous?.transition ?? global.transition) as { type?: string } | undefined;

  return declared?.type;
}

function sectionCues(section: Bag, previous: Bag | undefined, global: Bag, ctx: SpanContext): AutoCue[] {
  const type = previous ? transitionType(previous, global) : undefined;
  const whoosh: AutoCue[] = type && isDesignedTransition(type) ? [{ id: 'whoosh', at: 0 }] : [];
  const cues = [...whoosh, ...impactLands(section, ctx), ...cameraHits(section), ...dropRisers(section)];
  const length = ctx.duration;

  return cues
    .filter((cue) => cue.at >= 0 && (length === undefined || cue.at <= length))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

// A moment a sound is pinned to: its `at` and which edge lands there (a riser ENDS on its `at`, so it
// never competes with a hit starting on the same moment).
interface Landing {
  at: number;
  anchor: 'start' | 'end';
}

function landing(cue: { id?: unknown; sound?: unknown; at: number }): Landing {
  const sound = cue.sound as { anchor?: 'start' | 'end'; preset?: string } | undefined;
  const id = typeof cue.id === 'string' ? cue.id : sound?.preset;
  const library = id === undefined ? undefined : sfxEntry(id)?.anchor;

  return { at: cue.at, anchor: sound?.anchor ?? library ?? 'start' };
}

function authoredLandings(section: Bag): Landing[] {
  const sfx = Array.isArray(section.sfx) ? (section.sfx as Bag[]) : [];

  return sfx.flatMap((cue) =>
    typeof cue.at === 'number' ? [landing({ id: cue.id, sound: cue.sound, at: cue.at })] : []
  );
}

function spaced(cues: readonly AutoCue[], taken: Landing[]): AutoCue[] {
  const kept: AutoCue[] = [];

  for (const cue of cues) {
    const own = landing(cue);

    if (taken.some((other) => other.anchor === own.anchor && Math.abs(other.at - cue.at) < AUTO_SFX_SPACING)) continue;

    taken.push(own);
    kept.push(cue);
  }

  return kept;
}

/** The descriptor with the auto sound effects appended to each section's `sfx` (unchanged unless "auto"). */
export function expandAutoSfx<T extends { global?: unknown; sections?: unknown }>(
  descriptor: T,
  options: TimingOptions = {}
): T {
  const global = (descriptor.global ?? {}) as Bag;

  if ((global.audio as Bag | undefined)?.sfx !== 'auto' || !Array.isArray(descriptor.sections)) return descriptor;

  const frame = timingFrame(descriptor, options);
  let budget = AUTO_SFX_CAP;
  let previous: Bag | undefined;
  const sections = (descriptor.sections as Bag[]).map((section) => {
    if (!RENDERED.has(String(section.type))) return section;

    const ctx: SpanContext = {
      frame,
      duration: knownDuration(section as unknown as TimelineSection),
      text: timingText(descriptor, section, options),
    };
    const kept = spaced(sectionCues(section, previous, global, ctx), authoredLandings(section)).slice(0, budget);

    previous = section;
    budget -= kept.length;

    const authored = Array.isArray(section.sfx) ? (section.sfx as Bag[]) : [];

    return kept.length === 0 ? section : { ...section, sfx: [...authored, ...kept] };
  });

  return { ...descriptor, sections };
}
