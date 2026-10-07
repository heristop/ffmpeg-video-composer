// Pure completion/progress helpers for the builder's scene model, shared by the editor shell (and the
// legacy hub). No React/DOM — just the rules for "is this scene done", overall progress, and which
// scene the user should tackle next.
import { templateService, type Template, type InputSection } from '@/services/templateService';
import type { VideoEdit } from '@/domain/valueObjects/videoEdits';
import type { MediaChoice } from '@/presentation/components/admin/templateEditorModel';
import { bindFieldContracts, fieldSatisfied } from '@/presentation/components/template-form-fields.logic';

export interface SceneModel {
  clipsBySection: Record<string, File>;
  rushesBySection: Record<string, File[]>;
  editsBySection: Record<string, VideoEdit | undefined>;
  formData: Record<string, string>;
  musicChoice: MediaChoice | null;
  backgroundChoice: MediaChoice | null;
}

// A clip scene is done once a clip exists; a form scene once every one of its fields has a value that fits
// (a field bound to a declared `global.fields` entry with a default may stay empty).
export const sectionComplete = (template: Template, section: InputSection, model: SceneModel): boolean => {
  if (section.kind === 'clip') return Boolean(model.clipsBySection[section.name]);

  const fields = bindFieldContracts(
    templateService.extractFormFieldsForSection(template.descriptor, section.name),
    template.descriptor
  );

  return fields.every((f) => fieldSatisfied(f, model.formData[f.name] ?? ''));
};

// Media (music/background) counts as done once either a track or a background is chosen.
export const mediaComplete = (model: SceneModel): boolean => Boolean(model.musicChoice ?? model.backgroundChoice);

export interface HubProgress {
  totalItems: number;
  doneItems: number;
  progress: number;
  remaining: number;
}

export function hubProgress(
  sections: InputSection[],
  template: Template,
  model: SceneModel,
  showMedia: boolean
): HubProgress {
  const mediaItems = showMedia ? 1 : 0;
  const mediaDone = showMedia && mediaComplete(model) ? 1 : 0;
  const totalItems = sections.length + mediaItems;
  const doneItems = sections.filter((s) => sectionComplete(template, s, model)).length + mediaDone;
  const progress = totalItems > 0 ? (doneItems / totalItems) * 100 : 100;

  return { totalItems, doneItems, progress, remaining: totalItems - doneItems };
}

// The first not-yet-complete item: sections first, then the media row (media is "next" only once every
// section is done). `nextSectionIndex` is -1 when all sections are complete.
export function nextCue(sections: InputSection[], template: Template, model: SceneModel, showMedia: boolean) {
  const nextSectionIndex = sections.findIndex((section) => !sectionComplete(template, section, model));
  const mediaIsNext = showMedia && nextSectionIndex === -1 && !mediaComplete(model);

  return { nextSectionIndex, mediaIsNext };
}
