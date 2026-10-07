// Editor state -> the persisted user Template (the same projection the legacy editor used), shared by the
// shell's Save and the browser agent's save_template.
import { templateService, type Template } from '@/services/templateService';
import { buildDescriptor, type EditorState } from '../templateEditorModel';

export function toUserTemplate(state: EditorState): Template {
  const descriptor = buildDescriptor(state);

  return {
    id: state.id,
    name: state.name.trim(),
    description: state.description.trim(),
    orientation: state.orientation,
    hasForm: templateService.extractFormFields(descriptor).length > 0,
    complexity: templateService.getTemplateComplexity(descriptor),
    source: 'user',
    descriptor,
  };
}
