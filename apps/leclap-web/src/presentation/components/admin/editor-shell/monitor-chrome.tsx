// The program monitor's chrome for the template editor, gathered in one place: its status label, the
// format meta, the safe-area switch, and the sound that follows the playhead.
import type { ReactNode } from 'react';
import type { EditorState } from '../templateEditorModel';
import { PREVIEW_FPS } from './program-music.logic';
import type { Segment } from './program-timeline.logic';
import { formatLabel, SafeGuidesToggle } from './safe-guides';
import type { ProgramClock } from './use-program-clock';
import { useProgramMusic } from './use-program-music';

interface MonitorChrome {
  label: string;
  meta: string;
  controls: ReactNode;
}

// Editing a scene, playing the program, or parked on a program frame.
function monitorLabel(playMode: boolean, playing: boolean, t: (key: string) => string): string {
  if (!playMode) return t('shell.preview');

  return playing ? t('monitor.playing') : t('monitor.parked');
}

export function useMonitorChrome(
  state: EditorState,
  clock: ProgramClock,
  timeline: Segment[],
  playMode: boolean,
  t: (key: string, options?: Record<string, unknown>) => string
): MonitorChrome {
  useProgramMusic(state, clock, timeline);

  return {
    label: monitorLabel(playMode, clock.playing, t),
    meta: `${t(`orientationLabel.${state.orientation}`)} ${formatLabel(state.orientation, t('monitor.fps', { fps: PREVIEW_FPS }))}`,
    controls: <SafeGuidesToggle />,
  };
}
