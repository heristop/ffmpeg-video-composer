import { describe, expect, it } from 'vitest';
import { structureDrift, type ReferenceStructure } from 'ffmpeg-video-composer';
import { formatStructureSummary, templateSections } from '../src/commands/reference';

const structure: ReferenceStructure = {
  duration: 2.5,
  shots: [
    { index: 0, start: 0, end: 1, duration: 1, transitionIn: null, ground: 'dark', anchor: 'left', motion: 0.1 },
    {
      index: 1,
      start: 1,
      end: 2.5,
      duration: 1.5,
      transitionIn: 'cut',
      ground: 'light',
      anchor: 'center',
      motion: 0.6,
    },
  ],
  rhythm: { shots: 2, avgShot: 1.25, shortest: 1, longest: 1.5, cutsPerMinute: 24 },
};

describe('leclap reference', () => {
  it('summarises the rhythm and lists each shot', () => {
    const lines = formatStructureSummary(structure).join('\n');

    expect(lines).toContain('2 shots');
    expect(lines).toContain('1.5 s');
    expect(lines).toContain('light');
  });

  it('times a template’s sections for the drift check', () => {
    const template = {
      global: { orientation: 'landscape' },
      sections: [
        { name: 'a', type: 'color_background', options: { backgroundColor: '#000000', duration: 1 } },
        { name: 'b', type: 'color_background', options: { backgroundColor: '#ffffff', duration: 1.4 } },
      ],
    };

    expect(templateSections(template)).toEqual([
      { name: 'a', duration: 1, durationKnown: true },
      { name: 'b', duration: 1.4, durationKnown: true },
    ]);
  });

  describe('with overlapping transitions', () => {
    const dissolved: ReferenceStructure = {
      duration: 2,
      shots: [
        { index: 0, start: 0, end: 1, duration: 1, transitionIn: null, ground: 'dark', anchor: 'left', motion: 0.1 },
        {
          index: 1,
          start: 1,
          end: 2,
          duration: 1,
          transitionIn: 'dissolve',
          ground: 'light',
          anchor: 'center',
          motion: 0.6,
        },
      ],
      rhythm: { shots: 2, avgShot: 1, shortest: 1, longest: 1, cutsPerMinute: 60 },
    };
    const faded = (first: number) => ({
      global: { orientation: 'landscape' },
      sections: [
        {
          name: 'a',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: first },
          transition: { type: 'fade', duration: 0.5 },
        },
        { name: 'b', type: 'color_background', options: { backgroundColor: '#ffffff', duration: 1 } },
      ],
    });

    it('times each section as seen on screen, the next one pulled back by the fade', () => {
      expect(templateSections(faded(1.5))).toEqual([
        { name: 'a', duration: 1, durationKnown: true },
        { name: 'b', duration: 1, durationKnown: true },
      ]);
    });

    it('passes a template whose on-screen lengths match the shots', () => {
      expect(structureDrift(templateSections(faded(1.5)), dissolved)).toEqual([]);
    });

    it('flags a template whose nominal lengths equal the shots (the fade eats into them)', () => {
      expect(structureDrift(templateSections(faded(1)), dissolved).map((issue) => issue.code)).toEqual([
        'shot_duration',
      ]);
    });
  });
});
