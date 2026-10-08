// Which probed clip length a section's footage plan scales by (a preset ramp, an open clip range): the
// section's own clip (project_video), the clip of the section it reuses (video + useVideoSection), or none
// (a plain video section plans on its declared clip range or duration). One rule for the segment lowering
// (editor/utils/footage-section.ts), the render's transcription pass and `leclap transcribe`, so pinned
// words follow the same plan the video plays.

export interface SourceLengthSection {
  name: string;
  type?: string;
  options?: unknown;
}

/** Name of the section whose probed clip length applies, or null when the plan must not use one. */
export function sourceLengthKey(section: SourceLengthSection): string | null {
  if (section.type === 'project_video') return section.name;

  const reused = (section.options as { useVideoSection?: unknown } | undefined)?.useVideoSection;

  return section.type === 'video' && typeof reused === 'string' && reused ? reused : null;
}

/** The probed clip length a section's plan scales by, from the lengths probed by section name. */
export function sourceLengthFor(
  section: SourceLengthSection,
  lengths: Partial<Record<string, number>> | undefined
): number | undefined {
  const key = sourceLengthKey(section);

  return key === null ? undefined : lengths?.[key];
}
