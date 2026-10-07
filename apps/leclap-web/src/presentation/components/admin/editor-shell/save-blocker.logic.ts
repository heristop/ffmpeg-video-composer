import type { TFunction } from 'i18next';
import type { EditorSection, EditorState } from '../templateEditorModel';
import { sectionLabelKey } from './section-label';

// Why a template can't be saved yet, in the order the author should fix it. `media` carries the
// offending scene's index so the shell can jump straight to it.
export type SaveBlocker =
  | { kind: 'name' }
  | { kind: 'sections' }
  | { kind: 'media'; index: number; section: EditorSection['kind'] };

// A music or background-image scene the viewer can't fill: no option to pick and no upload allowed.
const offersNothing = (section: EditorSection): boolean =>
  (section.kind === 'music' || section.kind === 'image') && section.allowed.length === 0 && !section.allowUpload;

// The first reason the template isn't safe to save, or null when it is: a name, at least one scene,
// and something to pick (or an upload) in every media scene.
export function saveBlocker(state: EditorState): SaveBlocker | null {
  if (state.name.trim() === '') return { kind: 'name' };

  if (state.sections.length === 0) return { kind: 'sections' };

  const index = state.sections.findIndex(offersNothing);

  if (index === -1) return null;

  return { kind: 'media', index, section: state.sections[index].kind };
}

// The blocker in plain English for a browser agent (never shown in the UI), or null when saving may go ahead.
export function saveBlockerText(state: EditorState): string | null {
  const blocker = saveBlocker(state);

  if (!blocker) return null;

  return blocker.kind === 'media'
    ? `media: the ${blocker.section} section at position ${String(blocker.index)} offers nothing to pick or upload`
    : blocker.kind;
}

// The sentence telling the author what to fix, reusing the editor's validation copy.
export function saveBlockerMessage(blocker: SaveBlocker, t: TFunction<'admin'>): string {
  if (blocker.kind === 'name') return t('editor.validation.name');

  if (blocker.kind === 'sections') return t('editor.validation.atLeastOneSection');

  return t('editor.validation.mediaOrUpload', { label: t(sectionLabelKey(blocker.section)) });
}

// The line the titlebar shows under Save: a warning the author can act on, or an error when the write
// itself failed.
export interface SaveFeedback {
  tone: 'warning' | 'error';
  message: string;
  // The validator's own wording (English, technical) — kept beside the localized message, not in it.
  detail?: string;
}

// After a save attempt: why it was refused (`blocker`), or that storing it failed (`failure`, the
// thrown message, '' when there was none); null when there's nothing to say.
export function saveFeedback(
  blocker: SaveBlocker | null,
  failure: string | null,
  t: TFunction<'admin'>
): SaveFeedback | null {
  if (blocker) return { tone: 'warning', message: saveBlockerMessage(blocker, t) };

  if (failure === null) return null;

  return { tone: 'error', message: t('validation.saveFailed'), ...(failure ? { detail: failure } : {}) };
}
