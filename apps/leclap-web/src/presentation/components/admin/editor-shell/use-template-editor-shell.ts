// State hooks lifted out of TemplateEditorShell to keep the shell component itself thin: the live
// program monitor (playable timeline + rAF clock + play-mode bookkeeping) and template persistence
// (guard + projection + save). The shell composes these with the shared editor-state hooks.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useReducedMotion } from 'motion/react';
import { userTemplateService } from '@/services/userTemplateService';
import type { StoredTemplate } from '@/stores/userTemplateStore';
import type { EditorState } from '../templateEditorModel';
import { toUserTemplate } from './user-template';
import { buildMasterTimeline } from './program-timeline.logic';
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
  const [playMode, setPlayMode] = useState(false);

  useEffect(() => {
    if (clock.playing) setPlayMode(true);
  }, [clock.playing]);

  const exitPlayMode = (): void => {
    clock.pause();
    setPlayMode(false);
  };

  return { clock, playTimeline, playMode, exitPlayMode };
}

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
