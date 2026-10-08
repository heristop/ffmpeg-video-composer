import { describe, expect, it } from 'vitest';
import { buildEngineCatalog, motionForPrompt } from './engine-catalog';

describe('motionForPrompt', () => {
  const motion = buildEngineCatalog({ music: [], animations: [] }).motion;
  const trimmed = motionForPrompt(motion);

  it('keeps every sound effect with what it is for, without the mix details', () => {
    const sfx = trimmed.audio.sfx as unknown as Array<Record<string, unknown>>;

    expect(sfx.map((entry) => entry.id)).toEqual(motion.audio.sfx.map((entry) => entry.id));
    expect(sfx[0]).toHaveProperty('useWhen');
    expect(sfx[0]).not.toHaveProperty('avoidWhen');
    expect(sfx[0]).not.toHaveProperty('defaultVolume');
  });

  it('marks the sounds that end on their cue', () => {
    const riser = (trimmed.audio.sfx as unknown as Array<Record<string, unknown>>).find(
      (entry) => entry.id === 'riser'
    );

    expect(riser?.anchor).toBe('end');
  });

  it('leaves composed sounds to MCP agents: no compose section in the prompt', () => {
    expect(motion.audio).toHaveProperty('compose');
    expect(trimmed.audio).not.toHaveProperty('compose');
  });

  it('keeps HTML layers in a few lines: the shape and the subset rules, no lists or recipes', () => {
    const html = trimmed.html as unknown as Record<string, unknown>;

    expect(html.shape).toBe(motion.html.shape);
    expect(html.layout).toBe(motion.html.layout);
    expect(html).not.toHaveProperty('recipes');
    expect(html).not.toHaveProperty('tags');
    expect(JSON.stringify(html).length).toBeLessThan(1_500);
  });
});
