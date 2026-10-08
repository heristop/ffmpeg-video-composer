// Descriptor rules for `subtitles.transcribe` (auto-captions):
//
// - invalid_transcribe_source: `from` names no section, or a section without a clip (only video and
//   project_video sections carry sound to transcribe; "self" on a colour card has none).
// - transcribe_unavailable: a request on a host that cannot transcribe (the browser and on-device engines).
//   The Node pass pins the words first; the phone app pins them with the OS recogniser before compiling.

import type { TemplateDescriptor } from '../schemas/template.schemas';
import { transcribeTargets } from '@/core/captions/transcribe-requests';
import type { ValidationError } from './validation/types';

export function validateTranscribeSources(template: TemplateDescriptor): ValidationError[] {
  return transcribeTargets(template).flatMap((target) => {
    if (target.source !== null) return [];

    const from = target.request.from ?? 'self';
    const subject = from === 'self' ? `section "${target.name}" has` : `"${from}" is`;

    return [
      {
        path: `sections[${target.index}].subtitles.transcribe.from`,
        code: 'invalid_transcribe_source',
        message: `${subject} no clip to transcribe: only video and project_video sections carry speech`,
        hint: 'Set transcribe.from to the name of the video section whose speech these captions follow.',
      },
    ];
  });
}

export function validateTranscription(template: TemplateDescriptor, canTranscribe: boolean): ValidationError[] {
  if (canTranscribe) return [];

  return transcribeTargets(template).map((target) => ({
    path: `sections[${target.index}].subtitles.transcribe`,
    code: 'transcribe_unavailable',
    message: 'subtitles.transcribe needs the Node transcription pass: this engine cannot transcribe speech',
    hint:
      'pin the words first with `leclap transcribe <template>` or the transcribe_media MCP tool, ' +
      'then render the pinned template (the phone app pins them on device)',
  }));
}
