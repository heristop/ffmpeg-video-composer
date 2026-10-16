import { describe, expect, it } from 'vitest';
import { analyzeStructure, structureDrift, structurePromptRules } from '@/core/structure';
import { XFADE_TRANSITIONS } from '@/schemas/effects.schemas';
import { LECLAP_TRANSITION } from '@/core/structure/prompt';
import type { StyleFrame } from '@/core/style';

const W = 40;
const H = 30;
const flat = (value: number, time: number): StyleFrame => ({
  data: new Uint8Array(W * H * 3).fill(value),
  width: W,
  height: H,
  time,
});

// Three steady shots: 1 s dark, 0.5 s light, 1 s mid, hard cuts.
const clip = [
  ...[0, 1, 2, 3].map((k) => flat(20, k * 0.25)),
  ...[4, 5].map((k) => flat(235, k * 0.25)),
  ...[6, 7, 8, 9].map((k) => flat(120, k * 0.25)),
];

describe('analyzeStructure', () => {
  it('lists the shots with their timing and traits', () => {
    const structure = analyzeStructure({ frames: clip, duration: 2.5 });

    expect(structure.shots.map((s) => [s.start, s.end, s.ground, s.transitionIn])).toEqual([
      [0, 0.88, 'dark', null],
      [0.88, 1.38, 'light', 'cut'],
      [1.38, 2.5, 'mid', 'cut'],
    ]);
    expect(structure.rhythm).toMatchObject({ shots: 3, shortest: 0.5, longest: 1.12 });
  });

  it('clamps shots to a duration shorter than the sampled frames', () => {
    const structure = analyzeStructure({ frames: clip, duration: 1.2 });

    expect(structure.shots.length).toBeGreaterThan(0);
    for (const shot of structure.shots) {
      expect(shot.end).toBeLessThanOrEqual(1.2);
      expect(shot.duration).toBeGreaterThan(0);
    }
    expect(structure.rhythm.shortest).toBeGreaterThan(0);
  });

  it('reads one continuous shot when there is no cut', () => {
    const structure = analyzeStructure({ frames: [0, 1, 2, 3].map((k) => flat(90, k * 0.25)) });

    expect(structure.shots).toHaveLength(1);
    expect(structure.duration).toBe(1);
    expect(structurePromptRules(structure)).toContain('one continuous shot');
  });

  it('refuses a single frame', () => {
    expect(() => analyzeStructure({ frames: [flat(1, 0)] })).toThrow(/clip/);
  });
});

describe('structurePromptRules', () => {
  it('states the beats, the mapping and the scope rule', () => {
    const rules = structurePromptRules(analyzeStructure({ frames: clip, duration: 2.5 }));

    expect(rules).toContain('3 shots over 2.5 s');
    expect(rules).toContain('Shot 2: 0.5 s, light ground');
    expect(rules).toContain('"cut"');
    expect(rules).toMatch(/never .*subjects, logos or text/i);
  });

  it('lists at most 24 shots and summarises the rest', () => {
    // 30 one-second shots (4 frames each), alternating dark and light: a cut every 4 frames.
    const frames = Array.from({ length: 120 }, (_, k) => flat(Math.floor(k / 4) % 2 === 0 ? 20 : 235, k * 0.25));
    const rules = structurePromptRules(analyzeStructure({ frames }));

    expect(rules).toContain('Shot 24:');
    expect(rules).not.toContain('Shot 25:');
    expect(rules).toMatch(/more shots in the same rhythm/);
  });

  it('only maps to transitions LeClap knows', () => {
    for (const type of Object.values(LECLAP_TRANSITION).filter((name) => name !== 'cut')) {
      expect(XFADE_TRANSITIONS).toContain(type);
    }
  });
});

describe('structureDrift', () => {
  const structure = analyzeStructure({ frames: clip, duration: 2.5 });

  it('passes a template that follows the reference', () => {
    const sections = [0.9, 0.5, 1.1].map((duration, i) => ({ name: `s${i}`, duration }));

    expect(structureDrift(sections, structure)).toEqual([]);
  });

  it('flags a missing shot and a stretched one', () => {
    const issues = structureDrift([{ name: 'a', duration: 3 }], structure);

    expect(issues.map((issue) => issue.code)).toEqual(['shot_count', 'shot_duration']);
  });

  it('skips sections whose length is unknown', () => {
    const sections = [
      { name: 'a', duration: 9, durationKnown: false },
      { name: 'b', duration: 0.5 },
      { name: 'c', duration: 1.1 },
    ];

    expect(structureDrift(sections, structure)).toEqual([]);
  });
});
