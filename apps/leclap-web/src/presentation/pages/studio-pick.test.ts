import { describe, expect, it } from 'vitest';
import { studioPick } from './studio-pick';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const presentYourself = {
  id: 'present-yourself',
  orientation: 'landscape',
  formats: ['landscape', 'portrait'],
} as const;
const storyReel = { id: 'story-reel', orientation: 'portrait', formats: ['portrait'] } as const;

// A gallery pick opens the template in the device's format when the template composes it (sampleFormatFor).
describe('studioPick', () => {
  it('opens a two-format template in portrait on a phone', () => {
    expect(studioPick(presentYourself, PHONE)).toEqual({
      href: '/studio/new?template=present-yourself&format=portrait',
      format: 'portrait',
    });
  });

  it('opens it in its own landscape on a desktop', () => {
    expect(studioPick(presentYourself, DESKTOP)).toEqual({ href: '/studio/new?template=present-yourself' });
  });

  it('keeps a single-format template as authored, whatever the device', () => {
    expect(studioPick(storyReel, DESKTOP)).toEqual({ href: '/studio/new?template=story-reel' });
    expect(studioPick({ id: 'local:mine', orientation: 'landscape' }, PHONE)).toEqual({
      href: '/studio/new?template=local%3Amine',
    });
  });
});
