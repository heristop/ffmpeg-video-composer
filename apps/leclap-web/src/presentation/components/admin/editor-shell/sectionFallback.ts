import type { EditorSection } from '../templateEditorModel';
import { findMusic, MUSIC_LIBRARY, type MediaCredit } from '@/data/mediaCatalog';

// The track a music section will lay under the video: its first allowed library track, else the
// bundled default — the same "first allowed, else library default" rule the image sections use for
// their backdrop (see EditorMonitor.imageSectionUrl).
export function musicSectionTrack(section: EditorSection): MediaCredit | null {
  if (section.kind !== 'music') return null;

  return findMusic(section.allowed.at(0) ?? '') ?? MUSIC_LIBRARY.at(0) ?? null;
}
