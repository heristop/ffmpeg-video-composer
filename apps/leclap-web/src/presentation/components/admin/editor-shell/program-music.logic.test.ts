import { describe, expect, it } from 'vitest';
import { MUSIC_LIBRARY } from '@/data/mediaCatalog';
import { newSection, type EditorSection } from '../templateEditorModel';
import { buildMasterTimeline } from './program-timeline.logic';
import {
  adjacentEdge,
  musicGainAt,
  musicTimeAt,
  programMusicTrack,
  sceneEdges,
  snapToEdge,
  stepFrames,
} from './program-music.logic';

const mix = { sourceVolume: 1, musicVolume: 0.5, ducking: false };

function color(duration: number, extra: Partial<Extract<EditorSection, { kind: 'color' }>> = {}): EditorSection {
  return { ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>), duration, ...extra };
}

describe('programMusicTrack', () => {
  it('plays the default ticked track, the stand-in without one, and nothing without a music scene', () => {
    const [first, second] = MUSIC_LIBRARY;
    const music = { kind: 'music', allowed: [second.id, first.id], allowUpload: false } as EditorSection;

    expect(programMusicTrack([color(2), music])?.id).toBe(second.id);
    expect(programMusicTrack([{ kind: 'music', allowed: [], allowUpload: true } as EditorSection])?.id).toBe(first.id);
    expect(programMusicTrack([color(2)])).toBeNull();
  });
});

describe('musicGainAt', () => {
  it('uses the template level, a scene override, and the scene fades', () => {
    const sections = [
      color(4),
      color(4, { musicVolume: 0.2, audioFade: { in: { duration: 1 }, out: { duration: 2 } } }),
    ];
    const timeline = buildMasterTimeline(sections);

    expect(musicGainAt(timeline, sections, mix, 1)).toBeCloseTo(0.5);
    expect(musicGainAt(timeline, sections, mix, 4.5)).toBeCloseTo(0.1);
    expect(musicGainAt(timeline, sections, mix, 6)).toBeCloseTo(0.2);
    expect(musicGainAt(timeline, sections, mix, 7)).toBeCloseTo(0.1);
  });
});

describe('musicTimeAt', () => {
  it('loops the track under a longer timeline, like the render', () => {
    expect(musicTimeAt(130, 120)).toBeCloseTo(10);
    expect(musicTimeAt(5, Number.NaN)).toBe(5);
  });
});

describe('edit points', () => {
  const timeline = buildMasterTimeline([color(2), color(3), color(1)]);
  const edges = sceneEdges(timeline);

  it('lists every scene start and the end', () => {
    expect(edges).toEqual([0, 2, 5, 6]);
  });

  it('jumps to the next and previous edge, holding at the ends', () => {
    expect(adjacentEdge(edges, 2, 1)).toBe(5);
    expect(adjacentEdge(edges, 2.5, -1)).toBe(2);
    expect(adjacentEdge(edges, 6, 1)).toBe(6);
  });

  it('snaps a scrub onto a nearby edge only', () => {
    expect(snapToEdge(edges, 2.05, 0.1)).toBe(2);
    expect(snapToEdge(edges, 2.3, 0.1)).toBe(2.3);
  });

  it('steps whole frames at 30 fps, clamped to the timeline', () => {
    expect(stepFrames(1, 1, 6)).toBeCloseTo(31 / 30);
    expect(stepFrames(0, -1, 6)).toBe(0);
    expect(stepFrames(5.99, 30, 6)).toBe(6);
  });
});
