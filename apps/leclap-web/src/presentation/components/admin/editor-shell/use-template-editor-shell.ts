// State hooks lifted out of TemplateEditorShell to keep the shell component itself thin: the live
// program monitor (playable timeline + rAF clock + play-mode bookkeeping) and template persistence
// (guard + projection + save). The shell composes these with the shared editor-state hooks.
import { useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useReducedMotion } from 'motion/react';
import { userTemplateService } from '@/services/userTemplateService';
import type { StoredTemplate } from '@/stores/userTemplateStore';
import type { EditorState } from '../templateEditorModel';
import { toUserTemplate } from './user-template';
import { buildMasterTimeline, sceneClockAt } from './program-timeline.logic';
import { adjacentEdge, PREVIEW_FPS, sceneEdges, stepFrames } from './program-music.logic';
import { useProgramClock } from './use-program-clock';
import { saveBlocker, saveFeedback, type SaveBlocker } from './save-blocker.logic';

// The browser-agent (WebMCP) port and registration, surfaced here so the shell spends no import on it.
export { useBuilderAgent } from '../agent/use-builder-agent';

// The live program monitor's state: the visual scenes concatenated into one playable timeline driven
// by a rAF clock, plus play-mode bookkeeping (starting the clock enters play mode; exit pauses it).
export function useProgramMonitor(state: EditorState) {
  const reduced = useReducedMotion() ?? false;
  const playTimeline = useMemo(
    () => buildMasterTimeline(state.sections, state.defaultTransition),
    [state.sections, state.defaultTransition]
  );
  const playTotal = playTimeline.at(-1)?.end ?? 0;
  const clock = useProgramClock(playTotal, reduced);
  // Parked on the program: after a scrub, a frame step or an edit-point jump the monitor keeps showing
  // the frame under the playhead, like a paused program monitor, until the author goes back to editing.
  const [parked, setParked] = useState(false);
  const exitPlayMode = (): void => {
    clock.pause();
    setParked(false);
  };
  const park = (t: number): void => {
    clock.pause();
    clock.seekTo(t);
    setParked(true);
  };
  // J/K/L: a second press in the same direction doubles the speed, up to 4x.
  const shuttle = (direction: 1 | -1): void => {
    const same = clock.playing && Math.sign(clock.rate) === direction;
    const speed = same ? Math.min(Math.abs(clock.rate) * 2, MAX_SHUTTLE) : 1;
    setParked(true);
    clock.play(direction * speed);
  };

  return {
    clock,
    playTimeline,
    playMode: clock.playing || parked,
    exitPlayMode,
    park,
    shuttle,
    // Space: play/pause, staying on the program frame when it pauses.
    togglePlay: (): void => {
      setParked(true);
      clock.toggle();
    },
    // The scene under the playhead, so leaving the program view lands on what was showing.
    sceneAtPlayhead: (): number | null => sceneClockAt(playTimeline, clock.current())?.index ?? null,
    // ←/→ step a frame, Shift+←/→ a second.
    step: (count: number, unit: 'frame' | 'second'): void => {
      park(stepFrames(clock.current(), unit === 'second' ? count * PREVIEW_FPS : count, playTotal));
    },
    jumpEdit: (direction: 1 | -1): number | null => {
      const edge = adjacentEdge(sceneEdges(playTimeline), clock.current(), direction);
      park(edge);

      return sceneClockAt(playTimeline, edge)?.index ?? null;
    },
  };
}

const MAX_SHUTTLE = 4;

interface PersistenceArgs {
  state: EditorState;
  t: TFunction<'admin'>;
  onSaved: (saved: StoredTemplate) => void;
  onSaveAndCompile?: (saved: StoredTemplate) => void;
  // Shows a scene: a save refused over an empty media scene lands the author on it.
  onShowScene?: (index: number) => void;
}

// Save/persist for the shell: guards, projects to a user Template, writes it, and reports back through
// one `feedback` line beside the Save button. A refused save doesn't fail silently: it names the
// blocker until the author fixes it — but only once they've asked to save, so a template just started
// isn't nagged — and takes them to it: the titlebar's name field (`nameRef`), or the media scene that
// offers nothing. A failed write says so there too.
export function useTemplatePersistence({ state, t, onSaved, onSaveAndCompile, onShowScene }: PersistenceArgs) {
  // The thrown message of the last failed write ('' when it had none); null while nothing failed.
  const [failure, setFailure] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const blocker = saveBlocker(state);

  const refuse = (reason: SaveBlocker): void => {
    setAttempted(true);

    if (reason.kind === 'name') {
      nameRef.current?.focus();

      return;
    }

    if (reason.kind === 'media') onShowScene?.(reason.index);
  };

  const persist = (): StoredTemplate | null => {
    if (blocker) {
      refuse(blocker);

      return null;
    }
    setFailure(null);
    setAttempted(false);

    try {
      return userTemplateService.save(toUserTemplate(state));
    } catch (saveError) {
      setFailure(saveError instanceof Error ? saveError.message : '');

      return null;
    }
  };

  const handleSave = (): void => {
    const saved = persist();

    if (saved) onSaved(saved);
  };

  const handleSaveAndCompile = (): void => {
    const saved = persist();

    if (saved) onSaveAndCompile?.(saved);
  };

  const shownBlocker = attempted ? blocker : null;

  return {
    nameRef,
    blocker: shownBlocker,
    feedback: saveFeedback(shownBlocker, failure, t),
    handleSave,
    handleSaveAndCompile,
  };
}
