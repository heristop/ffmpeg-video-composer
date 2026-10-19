/**
 * Input index of a `video` section's clip. `VideoSegment` prepends a blank-audio (anullsrc) input at
 * `-i 0` unless the section is explicitly unmuted (`muteSection === false`), so a muted clip, which is
 * the default and holds for every source (own clip, `videoUrl`, `useVideoSection`), sits at input 1.
 * The segment and `MapManager.getVideoInputIncrement` both derive their stream indices from this rule.
 */
export function videoClipInputIndex(options?: { muteSection?: boolean }): number {
  return options?.muteSection === false ? 0 : 1;
}
