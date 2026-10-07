import { TemplateValidator, type MotionWarning } from 'ffmpeg-video-composer';
import { z } from 'zod';

// Pacing feedback for validate_template: the engine's advisory motion lint (ease monotony, front-loaded
// beats, dead air, flat tempo, exits fighting transitions…) plus assertions it could not measure
// render-free. Advisory like geometry: it never turns a valid template into an error.

export const motionWarningsSchema = z
  .array(
    z.object({
      path: z.string(),
      code: z.string(),
      message: z.string(),
      severity: z.enum(['warn', 'info']),
      hint: z.string().optional(),
    })
  )
  .optional()
  .describe(
    'Advisory pacing findings read off the motion timeline (ease_monotony, front_loaded, stagger_too_long, ' +
      'starts_at_zero, transition_monotony, exit_before_transition, dead_air, tempo_flat), the theme accent ' +
      'advisory (accent_overuse), the sameness lint (fx_untuned, effect_repeated, library_animation_sample, ' +
      'effect_off_theme, decor_overload: stock motion to recompose with the engine), a partial ref squeezed under ' +
      'its fixed intro/outro (partial_compressed), the typed field contract (field_undefined, field_unused, ' +
      'field_type_mismatch, field_missing_required) and assertions that ' +
      'could not be checked render-free (assertion_skipped), each with a hint — present only when there is ' +
      'something to say.'
  );

// Undefined — not [] — when the template is clean, so the key disappears from the payload. Partials are
// expanded by the engine, so paths index the expanded sections.
export function motionWarnings(template: unknown): MotionWarning[] | undefined {
  const warnings = new TemplateValidator().getMotionWarnings(template);

  return warnings.length > 0 ? warnings : undefined;
}

// The same findings for the text content block, which every client renders.
export function motionNote(warnings: MotionWarning[] | undefined): string {
  if (!warnings) {
    return '';
  }

  const lines = warnings.map((w) => `${w.path}: ${w.message}${w.hint ? ` — ${w.hint}` : ''} [${w.code}]`);

  return ` ${warnings.length} motion finding(s):\n- ${lines.join('\n- ')}`;
}
