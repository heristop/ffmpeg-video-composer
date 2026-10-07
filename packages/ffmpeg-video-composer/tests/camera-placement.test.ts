import { describe, expect, it } from 'vitest';
import type { Filter, Section } from '@/core/types';
import { cameraBackground, cameraEndOfChain, framedCamera } from '@/editor/presets/camera';
import type { SugarContext } from '@/editor/presets/sugar-context';

// Where the section camera lowers: end of chain (default), background sugar (includeText: false), or
// inside the authored chain right after its framing filters (includeText: false + framing ahead of text).

const ctx = {
  duration: 6,
  scale: '1280:720',
  fps: 30,
  isVideo: true,
  motion: { energy: 1, seedFor: () => 1, resolveText: () => '' },
} as unknown as SugarContext;

const framing: Filter[] = [
  { type: 'fps', value: '30' },
  { type: 'scale', value: '1120:558:force_original_aspect_ratio=decrease' },
  { type: 'pad', value: '1280:720:80:60' },
];
const text: Filter = { type: 'drawtext', values: { text: { en: 'Caption' }, x: 80, y: 22 } };

function section(filters: Filter[], includeText?: boolean): Section {
  const camera = { preset: 'push-in', amount: 0.025, delay: 1.6, duration: 4.8, includeText };

  return { name: 'v', type: 'project_video', camera, filters } as unknown as Section;
}

describe('camera placement', () => {
  it('runs at the end of the chain by default', () => {
    const s = section([...framing, text]);

    expect(cameraEndOfChain(s, ctx).some((filter) => filter.startsWith('zoompan='))).toBe(true);
    expect(cameraBackground(s, ctx)).toEqual([]);
    expect(framedCamera(s, ctx)).toEqual({ chain: s.filters, textAt: 0 });
  });

  it('stays background sugar when no framing precedes the text', () => {
    const s = section([text], false);

    expect(cameraBackground(s, ctx).map((filter) => filter.type)).toContain('zoompan');
    expect(framedCamera(s, ctx)).toEqual({ chain: s.filters, textAt: 0 });
  });

  it('stays background sugar when the authored chain has no text', () => {
    const s = section(framing, false);

    expect(cameraBackground(s, ctx)).not.toEqual([]);
    expect(framedCamera(s, ctx).textAt).toBe(0);
  });

  it('runs after the authored framing and ahead of the first text when includeText is false', () => {
    const s = section([...framing, text], false);
    const { chain, textAt } = framedCamera(s, ctx);
    const types = chain.map((filter) => filter.type);

    expect(cameraBackground(s, ctx)).toEqual([]);
    expect(cameraEndOfChain(s, ctx)).toEqual([]);
    expect(types.slice(0, 3)).toEqual(['fps', 'scale', 'pad']);
    expect(types.indexOf('zoompan')).toBeGreaterThan(2);
    expect(types.indexOf('zoompan')).toBeLessThan(types.indexOf('drawtext'));
    expect(chain[textAt]).toBe(text);
  });
});
