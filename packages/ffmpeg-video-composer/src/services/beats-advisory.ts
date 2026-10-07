// beat_grid_low_confidence: an analysed beat grid (global.beats with `usable: false`, as `leclap beats`,
// the analyze_music MCP tool or the Node compile report it) whose music has no reliable pulse. Cuts and
// hits on such a grid land on nothing the viewer hears, so the advice is to pace by phrases instead.
// Advisory, like the pacing lint: it never enters `errors`.

import type { MotionWarning } from './motion-lint';

type BeatsView = { usable?: unknown; confidence?: unknown };

export function beatGridAdvisories(template: unknown): MotionWarning[] {
  const beats = (template as { global?: { beats?: BeatsView } } | null)?.global?.beats;

  if (beats?.usable !== false) return [];

  const confidence = typeof beats.confidence === 'number' ? ` (confidence ${beats.confidence})` : '';

  return [
    {
      path: 'global.beats',
      code: 'beat_grid_low_confidence',
      severity: 'warn',
      message: `The analysed music has no reliable pulse${confidence}: beat and bar references land on nothing audible`,
      hint: 'Pace by phrases: set section lengths in seconds and time entrances to the words, or pick a track with a clear beat.',
    },
  ];
}
