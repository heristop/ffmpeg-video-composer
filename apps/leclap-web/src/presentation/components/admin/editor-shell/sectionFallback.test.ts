import { describe, it, expect } from 'vitest';
import { musicSectionTrack } from './sectionFallback';
import { newSection } from '../templateEditorModel';
import { MUSIC_LIBRARY } from '@/data/mediaCatalog';

describe('musicSectionTrack', () => {
  it('resolves the first allowed library track', () => {
    const section = newSection('music');
    if (section.kind !== 'music') throw new Error('expected a music section');
    const pick = MUSIC_LIBRARY.at(1) ?? MUSIC_LIBRARY.at(0);
    if (!pick) throw new Error('expected a bundled music library');
    section.allowed = [pick.id];

    expect(musicSectionTrack(section)).toEqual(pick);
  });

  it('falls back to the default library track when nothing is selected or the id is unknown', () => {
    const section = newSection('music');
    expect(musicSectionTrack(section)).toEqual(MUSIC_LIBRARY.at(0));

    if (section.kind !== 'music') throw new Error('expected a music section');
    section.allowed = ['nope'];
    expect(musicSectionTrack(section)).toEqual(MUSIC_LIBRARY.at(0));
  });

  it('returns nothing for non-music sections', () => {
    expect(musicSectionTrack(newSection('form'))).toBeNull();
  });
});
