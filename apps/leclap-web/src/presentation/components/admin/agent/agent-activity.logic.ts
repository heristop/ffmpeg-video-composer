// Pure state for the browser-agent activity UI: the capped log (newest first), the pill's state, which
// log entries can still be undone, and the batched summary the live region announces once the agent
// pauses (so a burst of calls is one announcement, not a stream of them).
import type { EditorState } from '@/presentation/components/admin/templateEditorModel';
import type { ActivityInput } from '@/application/usecases/webmcp/types';

export const MAX_ENTRIES = 50;
/** How long the agent must be quiet before the live region speaks. */
export const ANNOUNCE_DELAY_MS = 1000;
/** How long changed scene cards keep their highlight ring. */
export const HIGHLIGHT_MS = 2000;

export interface ActivityEntry extends ActivityInput {
  id: number;
  /** Epoch milliseconds. */
  at: number;
}

export type ActivityAction = { type: 'add'; entry: ActivityEntry } | { type: 'clear' };

export function activityReducer(entries: ActivityEntry[], action: ActivityAction): ActivityEntry[] {
  if (action.type === 'clear') return [];

  return [action.entry, ...entries].slice(0, MAX_ENTRIES);
}

export type PillState = 'off' | 'idle' | 'working';

export function pillState(enabled: boolean, inFlight: number): PillState {
  if (!enabled) return 'off';

  return inFlight > 0 ? 'working' : 'idle';
}

/** An edit's entry can be undone while the state it produced is still the present one. */
export function canUndoEntry(entry: ActivityEntry, present: EditorState): boolean {
  return entry.status === 'ok' && entry.produced !== undefined && entry.produced === present;
}

/** What the live region says about a burst of calls; read-only calls stay silent. */
export type LiveSummary =
  | { key: 'changed'; count: number }
  | { key: 'settings'; count: number }
  | { key: 'declined'; count: number }
  | { key: 'failed'; count: number };

export function liveSummary(batch: readonly ActivityInput[]): LiveSummary | null {
  const actions = batch.filter((input) => input.kind !== 'read');

  if (actions.length === 0) return null;

  const declined = actions.filter((input) => input.status === 'declined').length;
  const failed = actions.filter((input) => input.status === 'error').length;
  const done = actions.filter((input) => input.status === 'ok');
  const scenes = new Set(done.flatMap((input) => input.changed)).size;

  if (scenes > 0) return { key: 'changed', count: scenes };

  if (done.length > 0) return { key: 'settings', count: done.length };

  return declined > 0 ? { key: 'declined', count: declined } : { key: 'failed', count: failed };
}

/** Short wall-clock label for a log entry (HH:MM:SS in the user's locale). */
export function entryTime(at: number, locale: string): string {
  return new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
