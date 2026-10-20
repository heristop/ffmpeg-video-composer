// Pure rules behind the music track list: which ticked track is the default, how the keyboard drives
// the list, and how the monitor summarises the other choices.

// The default is the first ticked track: the render and the draft preview both lay `allowed[0]` under
// the video (sectionFallback.musicSectionTrack, previewRender.fillPreviewMusic). Making a track the
// default moves it to the front and keeps the others in their order.
export function makeDefault(allowed: string[], id: string): string[] {
  if (!allowed.includes(id)) return allowed;

  return [id, ...allowed.filter((other) => other !== id)];
}

export type TrackKeyAction = 'toggle' | 'preview' | 'makeDefault' | 'stop' | 'next' | 'prev' | 'first' | 'last';

// Enter ticks (the button's own click), Space previews like a transport, D makes the focused track the
// default, Escape stops the preview, arrows/Home/End move between rows.
const KEY_ACTIONS: Record<string, TrackKeyAction> = {
  ' ': 'preview',
  d: 'makeDefault',
  D: 'makeDefault',
  Escape: 'stop',
  ArrowDown: 'next',
  ArrowUp: 'prev',
  Home: 'first',
  End: 'last',
};

export function trackKeyAction(key: string): TrackKeyAction | null {
  return KEY_ACTIONS[key] ?? null;
}

// The row a movement key lands on, clamped to the list (no wrap: a list edge should feel like one).
export function moveIndex(action: TrackKeyAction, index: number, count: number): number {
  if (count === 0) return 0;

  if (action === 'first') return 0;

  if (action === 'last') return count - 1;

  if (action === 'next') return Math.min(index + 1, count - 1);

  if (action === 'prev') return Math.max(index - 1, 0);

  return index;
}

// The alternatives the monitor names after the default: up to `max` titles, plus how many are left.
export function alternativesSummary(titles: string[], max = 2): { shown: string[]; more: number } {
  return { shown: titles.slice(0, max), more: Math.max(0, titles.length - max) };
}

export type MoodFilter = 'all' | 'calm' | 'upbeat' | 'jazzy' | 'playful';
export type TempoFilter = 'any' | 'slow' | 'mid' | 'fast';

interface Filterable {
  bpm?: number;
  moods?: readonly string[];
}

// Under 90, 90–120, over 120 BPM. A track without a trusted tempo only shows under "any".
function inTempo(bpm: number | undefined, tempo: TempoFilter): boolean {
  if (tempo === 'any') return true;

  if (bpm === undefined) return false;

  if (tempo === 'slow') return bpm < 90;

  if (tempo === 'mid') return bpm >= 90 && bpm <= 120;

  return bpm > 120;
}

export function filterTracks<T extends Filterable>(items: readonly T[], mood: MoodFilter, tempo: TempoFilter): T[] {
  return items.filter((item) => (mood === 'all' || item.moods?.includes(mood) === true) && inTempo(item.bpm, tempo));
}
