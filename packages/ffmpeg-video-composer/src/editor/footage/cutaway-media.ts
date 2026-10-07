import type { Media, Section } from '@/core/types';

/** The section's B-roll cutaway clips as media assets (staged by the AssetManager like any other media). */
export function cutawayMedia(section: Section): Media[] {
  return (section.cutaways ?? []).map((cutaway, i) => ({ name: `${section.name}_cutaway${i}`, url: cutaway.url }));
}
