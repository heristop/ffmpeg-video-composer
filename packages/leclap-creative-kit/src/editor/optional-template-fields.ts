import type { EditableTemplate, EditorState } from './model';
import { editorFormatsFrom } from './formats-passthrough';
import { editorMotionFrom } from './motion-passthrough';
import { watermarkFrom } from './to-editor-overlay';

export function optionalTemplateFields(template: EditableTemplate): Partial<EditorState> {
  const motion = editorMotionFrom(template.descriptor.global);
  const formats = editorFormatsFrom(template.descriptor);
  const watermark = watermarkFrom(template.descriptor.global);
  const global = template.descriptor.global;

  return {
    ...(motion ? { motion } : {}),
    ...(formats ? { formats } : {}),
    ...(watermark ? { watermark } : {}),
    ...(global?.look ? { globalLook: typeof global.look === 'string' ? global.look : global.look.preset } : {}),
  };
}
