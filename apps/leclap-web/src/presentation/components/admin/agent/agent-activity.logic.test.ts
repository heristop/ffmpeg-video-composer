import { describe, expect, it } from 'vitest';
import { toEditorState } from '@/presentation/components/admin/templateEditorModel';
import type { ActivityInput } from '@/application/usecases/webmcp/types';
import {
  activityReducer,
  canUndoEntry,
  liveSummary,
  MAX_ENTRIES,
  pillState,
  type ActivityEntry,
} from './agent-activity.logic';

function input(over: Partial<ActivityInput>): ActivityInput {
  return { tool: 'edit_template', kind: 'edit', status: 'ok', changed: [], ...over };
}

function entry(id: number, over: Partial<ActivityInput> = {}): ActivityEntry {
  return { ...input(over), id, at: id };
}

describe('activity log', () => {
  it('keeps the newest first and caps the log', () => {
    let entries: ActivityEntry[] = [];

    for (let id = 0; id < MAX_ENTRIES + 5; id += 1) {
      entries = activityReducer(entries, { type: 'add', entry: entry(id) });
    }

    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[0].id).toBe(MAX_ENTRIES + 4);
    expect(activityReducer(entries, { type: 'clear' })).toEqual([]);
  });

  it('offers undo only while the produced state is present', () => {
    const produced = toEditorState(null);
    const other = toEditorState(null);

    expect(canUndoEntry(entry(1, { produced }), produced)).toBe(true);
    expect(canUndoEntry(entry(1, { produced }), other)).toBe(false);
    expect(canUndoEntry(entry(1), produced)).toBe(false);
    expect(canUndoEntry(entry(1, { produced, status: 'error' }), produced)).toBe(false);
  });
});

describe('pill state', () => {
  it('is off when disabled, working while calls run, idle otherwise', () => {
    expect(pillState(false, 3)).toBe('off');
    expect(pillState(true, 1)).toBe('working');
    expect(pillState(true, 0)).toBe('idle');
  });
});

describe('live summary', () => {
  it('stays silent for reads and counts distinct changed scenes', () => {
    expect(liveSummary([input({ kind: 'read', tool: 'get_template' })])).toBeNull();
    expect(liveSummary([input({ changed: [1, 2] }), input({ changed: [2] })])).toEqual({ key: 'changed', count: 2 });
  });

  it('falls back to template-wide changes, then declines, then failures', () => {
    expect(liveSummary([input({})])).toEqual({ key: 'settings', count: 1 });
    expect(liveSummary([input({ status: 'declined' }), input({ status: 'error' })])).toEqual({
      key: 'declined',
      count: 1,
    });
    expect(liveSummary([input({ status: 'error' })])).toEqual({ key: 'failed', count: 1 });
  });
});
