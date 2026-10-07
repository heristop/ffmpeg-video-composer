import type { ValidationError } from 'ffmpeg-video-composer';
import { z } from 'zod';

// validate_template's `featureWarnings`: what the template uses that the local FFmpeg cannot render,
// from the same cached probe as get_capabilities. Advisory like geometry and motion.

export const featureWarningsSchema = z
  .array(z.object({ path: z.string(), code: z.string(), message: z.string(), hint: z.string().optional() }))
  .optional()
  .describe(
    'feature_unavailable findings: a caption/kinetic text, designed transition, LUT look, blur or loudnorm the ' +
      'local FFmpeg cannot run (see get_capabilities), with the fix — present only when there is something to say. ' +
      'The render drops such filters and cuts instead of crossfading; another machine may render them.'
  );

export function featureNote(warnings: ValidationError[] | undefined): string {
  if (!warnings) {
    return '';
  }

  const lines = warnings.map((w) => `${w.path}: ${w.message}${w.hint ? ` — ${w.hint}` : ''}`);

  return ` ${warnings.length} backend finding(s):\n- ${lines.join('\n- ')}`;
}
