// Sound advisories: the guardrails for an author who can't hear, read render-free like the pacing lint
// (they never enter `errors`), each with a fix hint. Surfaced by getMotionWarnings (CLI `validate`, MCP
// validate_template).
//   sound_clipped   the layers of a rendered sound sum far over full scale (sound-advisories-spectral.ts);
//   sound_harsh     a sustained sound with most of its energy above 8 kHz (idem);
//   sound_muddy     a long, low-heavy sound under music (idem);
//   sound_long      a section's sound running well past the section's end;
//   sound_repeated  the same sound on every cue of a list (3 or more; typing and counting sounds excepted);
//   sound_overlap   more sounds playing at once than the ear separates.

import type { MotionWarning } from './motion-lint';
import { SPECTRAL_THRESHOLDS, spectralAdvisories } from './sound-advisories-spectral';
import { cueLists, hasMusic, type CueList, type CueSound } from './sound-cues';

export const SOUND_THRESHOLDS = {
  ...SPECTRAL_THRESHOLDS,
  // A tail under half a second past the cut reads as the sound decaying; longer, it marks the next section.
  longTail: 0.5,
  // Three cues of the same sound in a list is a pattern the ear notices; vary pitch instead.
  repeatedCount: 3,
  // Library sounds made to repeat: a typing rhythm, a counter step, a UI tap.
  repeatable: ['keystroke', 'tick', 'click'] as readonly string[],
  // Three simultaneous effects is about what the ear separates over music; a fourth turns them into a wall.
  maxConcurrent: 3,
};

function warn(path: string, code: string, message: string, hint: string): MotionWarning {
  return { path, code, message, severity: 'warn', hint };
}

function soundKey(cue: CueSound): string {
  return cue.resolved.file;
}

function tooLong(list: CueList): MotionWarning[] {
  const { duration } = list;

  if (duration === null) return [];

  return list.cues
    .filter((cue) => cue.end !== null && cue.end > duration + SOUND_THRESHOLDS.longTail)
    .map((cue) =>
      warn(
        cue.path,
        'sound_long',
        `${cue.resolved.id} runs ${((cue.end ?? 0) - duration).toFixed(2)} s past the end of its section`,
        'Place it earlier, pick a shorter sound, or give the sound a shorter length.'
      )
    );
}

function repeated(list: CueList): MotionWarning[] {
  const keys = new Set(list.cues.map(soundKey));

  if (list.cues.length < SOUND_THRESHOLDS.repeatedCount || keys.size !== 1) return [];

  if (!list.cues[0].resolved.sound && SOUND_THRESHOLDS.repeatable.includes(list.cues[0].resolved.id)) return [];

  return [
    warn(
      list.path,
      'sound_repeated',
      `every cue plays the same sound (${list.cues[0].resolved.id} ×${list.cues.length})`,
      'Vary it per cue: { sound: { preset, pitch: 0.9 / 1 / 1.12 } } keeps the family, drops the loop.'
    ),
  ];
}

function overlap(list: CueList): MotionWarning[] {
  const timed = list.cues.filter((cue) => cue.start !== null).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const crowded = timed.find(
    (cue, i) =>
      timed.slice(0, i).filter((other) => (other.end ?? 0) > (cue.start ?? 0)).length >= SOUND_THRESHOLDS.maxConcurrent
  );

  if (!crowded) return [];

  return [
    warn(
      crowded.path,
      'sound_overlap',
      `${SOUND_THRESHOLDS.maxConcurrent + 1} or more sounds play at once here`,
      'Keep one sound per visual event; drop or space the others.'
    ),
  ];
}

export function soundAdvisories(descriptor: unknown): MotionWarning[] {
  const lists = cueLists(descriptor);
  const timing = lists.flatMap((list) => [...tooLong(list), ...repeated(list), ...overlap(list)]);

  return [
    ...spectralAdvisories(
      lists.flatMap((list) => list.cues),
      hasMusic(descriptor)
    ),
    ...timing,
  ];
}
