import { useEffect, useState } from 'react';
import type { TemplateOrientation } from '@leclap/creative-kit';
import { templateService, type Template } from '@/services/templateService';
import { recordingConfigFromDescriptor, type RecordingConfig } from '@/lib/recordingConfig';
import { logger } from '@/lib/logger';

// Preload the onboarding sample template, in the format the onboarding picked, and derive the camera's recording config from its descriptor
// (countdown/duration/framing). The template is loaded up front so the camera can read that config
// before the user starts recording.
export function useSampleTemplate(
  sampleTemplateId: string,
  format: TemplateOrientation
): {
  template: Template | null;
  recordingConfig: RecordingConfig;
} {
  const [template, setTemplate] = useState<Template | null>(null);

  useEffect(() => {
    templateService
      .getTemplate(sampleTemplateId, format)
      .then(setTemplate)
      .catch((error: unknown) => {
        logger.error('Onboarding template preload failed:', error);
      });
  }, [sampleTemplateId, format]);

  return { template, recordingConfig: recordingConfigFromDescriptor(template?.descriptor) };
}
