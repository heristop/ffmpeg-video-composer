// Drawtext overlays may time their reveal/exit with a time reference ("title.end + 0.2"), which only the
// engine can resolve (it needs the other elements' layout). The builder's controls and live preview work
// in seconds, so a reference shows as the default timing here; the rendered video still uses it.
import type { Exit, Reveal, TextOverlay } from '../templateEditorModel';

/** The overlay's reveal with a time-reference delay dropped to the default, for controls and preview. */
export function editableReveal(reveal: TextOverlay['reveal']): Reveal | undefined {
  if (!reveal || typeof reveal === 'string' || typeof reveal.delay !== 'string') return reveal as Reveal | undefined;

  const { delay: _reference, ...rest } = reveal;

  return rest;
}

/** The overlay's exit with a time-reference start dropped to the default, for controls and preview. */
export function editableExit(exit: TextOverlay['exit']): Exit | undefined {
  if (!exit || typeof exit === 'string' || typeof exit.after !== 'string') return exit as Exit | undefined;

  const { after: _reference, ...rest } = exit;

  return rest;
}
