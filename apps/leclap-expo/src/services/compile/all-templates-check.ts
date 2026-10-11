import type { Orientation, TemplateDescriptor } from '@/src/types';
import type { CompileRecordedVideos } from '@/src/services/api';

// The all-templates device check (leclap://all-templates-test): compiles every bundled template through
// the real on-device path, with the bundled sample clip in each recorded slot, and logs one greppable
// line per template so a device run can be read from logcat / the simulator log.

export interface CheckRow {
  id: string;
  status: 'RUN' | 'OK' | 'FAIL';
  secs?: number;
  info?: string;
}

/** The templates to run: all of them, or only the ids listed in `?only=a,b` (kept in catalog order). */
export function selectTemplates<T extends { id: string }>(templates: readonly T[], only?: string): T[] {
  const ids = only ? only.split(',').filter(Boolean) : [];

  if (ids.length === 0) return [...templates];

  return templates.filter((t) => ids.includes(t.id));
}

/** Every recorded (`project_video`) section filled with the sample clip. */
export function clipSlots(
  descriptor: TemplateDescriptor,
  clipPath: string,
  orientation: Orientation
): CompileRecordedVideos {
  const slots: CompileRecordedVideos = {};

  for (const section of descriptor.sections ?? []) {
    if (section.type === 'project_video') slots[section.name] = { path: clipPath, orientation };
  }

  return slots;
}

export function checkSummary(rows: readonly CheckRow[], done: boolean): string {
  const passed = rows.filter((r) => r.status === 'OK').length;

  return done ? `DONE ${passed}/${rows.length} OK` : `Running… ${passed}/${rows.length}`;
}

export function logLine(row: CheckRow): string {
  const secs = row.secs === undefined ? '' : ` secs=${row.secs.toFixed(1)}`;
  const info = row.info ? ` ${row.info}` : '';

  return `LECLAP_ALLTEMPLATES ${row.id}=${row.status}${secs}${info}`;
}
