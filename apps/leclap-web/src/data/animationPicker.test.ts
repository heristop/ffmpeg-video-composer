import { describe, expect, it } from 'vitest';
import admin from '@/i18n/locales/en/admin.json';
import { ANIMATION_PICKER, findEngineCard, findSampleCard } from './mediaCatalog';

const labels = admin.animation.library as Record<string, string>;

describe('animation picker catalog', () => {
  it('lists engine groups first and the legacy samples last', () => {
    expect(ANIMATION_PICKER.map((group) => group.group)).toEqual([
      'light',
      'focus',
      'celebrate',
      'frames',
      'ambient',
      'samples',
    ]);
    for (const group of ANIMATION_PICKER.slice(0, -1)) {
      expect(group.cards.length).toBeGreaterThan(0);
      for (const card of group.cards) expect(card.engine?.group).toBe(group.group);
    }
    for (const card of ANIMATION_PICKER.at(-1)!.cards) expect(card.sample).toBeDefined();
  });

  it('hides animation icons and folds the spec orbit into the orbit glint', () => {
    const ids = ANIMATION_PICKER.flatMap((group) => group.cards.map((card) => card.id));

    expect(ids).not.toContain('animation-icons');
    expect(ids).not.toContain('spec-orbit');
    expect(findEngineCard('glint-orbit')?.engine?.preset).toEqual({ type: 'fx', effect: 'glint', path: 'orbit' });
    expect(findSampleCard('/assets/animations/spec_orbit.apng')).toBeUndefined();
    expect(findSampleCard('/assets/animations/shine_sweep.apng')?.id).toBe('shine-sweep');
  });

  it('gives every card a human label and an engine-rendered thumbnail with its poster', () => {
    const cards = ANIMATION_PICKER.flatMap((group) => group.cards);

    expect(new Set(cards.map((card) => card.key)).size).toBe(cards.length);
    for (const card of cards) {
      expect(labels[card.id], card.id).toBeTruthy();
      expect(card.labelKey).toBe(`animation.library.${card.id}`);
      expect(card.poster, card.key).toMatch(/^\/assets\/animation-thumbs\/.+\.png$/);
      if (card.engine) expect(card.thumb, card.key).toMatch(/\.webp$/);
    }
  });
});
