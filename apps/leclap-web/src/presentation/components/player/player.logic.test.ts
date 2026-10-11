import { describe, expect, it } from 'vitest';
import {
  PLAYBACK_RATES,
  controlsShown,
  formatClock,
  formatRate,
  fraction,
  fullscreenPlan,
  keySeekTarget,
  playerKeyAction,
  pointerTime,
  readRate,
  stepRate,
} from './player.logic';

describe('formatClock', () => {
  it('prints minutes and zero-padded seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9.9)).toBe('0:09');
    expect(formatClock(83)).toBe('1:23');
    expect(formatClock(372.4)).toBe('6:12');
  });

  it('adds hours past the hour', () => {
    expect(formatClock(3725)).toBe('1:02:05');
  });

  it('reads an unknown or negative time as zero', () => {
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatClock(-4)).toBe('0:00');
  });
});

describe('fraction', () => {
  it('is the clamped share of the whole', () => {
    expect(fraction(30, 120)).toBe(0.25);
    expect(fraction(200, 120)).toBe(1);
    expect(fraction(-1, 120)).toBe(0);
  });

  it('is zero while the duration is unknown', () => {
    expect(fraction(3, 0)).toBe(0);
  });
});

describe('pointerTime', () => {
  const track = { left: 100, width: 200 };

  it('maps the pointer across the track to the duration', () => {
    expect(pointerTime(100, track, 60)).toBe(0);
    expect(pointerTime(200, track, 60)).toBe(30);
    expect(pointerTime(300, track, 60)).toBe(60);
  });

  it('clamps past either end', () => {
    expect(pointerTime(20, track, 60)).toBe(0);
    expect(pointerTime(900, track, 60)).toBe(60);
  });

  it('is zero on a collapsed track', () => {
    expect(pointerTime(150, { left: 100, width: 0 }, 60)).toBe(0);
  });
});

describe('keySeekTarget', () => {
  it('steps five seconds on the arrows, clamped to the film', () => {
    expect(keySeekTarget('ArrowRight', 10, 60)).toBe(15);
    expect(keySeekTarget('ArrowUp', 58, 60)).toBe(60);
    expect(keySeekTarget('ArrowLeft', 10, 60)).toBe(5);
    expect(keySeekTarget('ArrowDown', 2, 60)).toBe(0);
  });

  it('pages a tenth and jumps to the ends', () => {
    expect(keySeekTarget('PageUp', 10, 60)).toBe(16);
    expect(keySeekTarget('PageDown', 10, 60)).toBe(4);
    expect(keySeekTarget('Home', 30, 60)).toBe(0);
    expect(keySeekTarget('End', 30, 60)).toBe(60);
  });

  it('leaves other keys alone', () => {
    expect(keySeekTarget('a', 10, 60)).toBeNull();
  });
});

describe('stepRate', () => {
  it('offers the six speeds, normal in the middle', () => {
    expect(PLAYBACK_RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });

  it('steps up and down the ladder', () => {
    expect(stepRate(1, 1)).toBe(1.25);
    expect(stepRate(1, -1)).toBe(0.75);
    expect(stepRate(1.5, 1)).toBe(2);
  });

  it('stops at either end', () => {
    expect(stepRate(2, 1)).toBe(2);
    expect(stepRate(0.5, -1)).toBe(0.5);
  });

  it('snaps an off-ladder rate to the next speed in that direction', () => {
    expect(stepRate(1.1, 1)).toBe(1.25);
    expect(stepRate(1.1, -1)).toBe(1);
  });
});

describe('formatRate', () => {
  it('prints the speed with a multiplication sign', () => {
    expect(formatRate(1)).toBe('1×');
    expect(formatRate(0.75)).toBe('0.75×');
    expect(formatRate(1.5)).toBe('1.5×');
  });
});

describe('readRate', () => {
  it('keeps a stored speed from the ladder', () => {
    expect(readRate('1.5')).toBe(1.5);
  });

  it('falls back to normal speed for anything else', () => {
    expect(readRate(null)).toBe(1);
    expect(readRate('3')).toBe(1);
    expect(readRate('fast')).toBe(1);
  });
});

const key = (value: string, extra: Partial<Parameters<typeof playerKeyAction>[0]> = {}) =>
  playerKeyAction({ key: value, ...extra });

describe('playerKeyAction', () => {
  it('toggles playback on space and k', () => {
    expect(key(' ')).toEqual({ type: 'toggle' });
    expect(key('k')).toEqual({ type: 'toggle' });
    expect(key('K')).toEqual({ type: 'toggle' });
  });

  it('seeks five seconds on the arrows and ten on j and l', () => {
    expect(key('ArrowLeft')).toEqual({ type: 'seekBy', seconds: -5 });
    expect(key('ArrowRight')).toEqual({ type: 'seekBy', seconds: 5 });
    expect(key('j')).toEqual({ type: 'seekBy', seconds: -10 });
    expect(key('l')).toEqual({ type: 'seekBy', seconds: 10 });
  });

  it('jumps to a tenth of the film on a digit, and to the ends on Home and End', () => {
    expect(key('0')).toEqual({ type: 'seekTo', fraction: 0 });
    expect(key('7')).toEqual({ type: 'seekTo', fraction: 0.7 });
    expect(key('Home')).toEqual({ type: 'seekTo', fraction: 0 });
    expect(key('End')).toEqual({ type: 'seekTo', fraction: 1 });
  });

  it('nudges the volume on the vertical arrows', () => {
    expect(key('ArrowUp')).toEqual({ type: 'volumeBy', delta: 0.1 });
    expect(key('ArrowDown')).toEqual({ type: 'volumeBy', delta: -0.1 });
  });

  it('mutes on m, goes fullscreen on f, toggles captions on c', () => {
    expect(key('m')).toEqual({ type: 'mute' });
    expect(key('f')).toEqual({ type: 'fullscreen' });
    expect(key('c')).toEqual({ type: 'captions' });
  });

  it('opens or closes picture-in-picture on p', () => {
    expect(key('p')).toEqual({ type: 'pip' });
    expect(key('P', { shiftKey: true })).toEqual({ type: 'pip' });
  });

  it('steps the speed on < and >', () => {
    expect(key('<', { shiftKey: true })).toEqual({ type: 'rate', direction: -1 });
    expect(key('>', { shiftKey: true })).toEqual({ type: 'rate', direction: 1 });
  });

  it('leaves browser and system shortcuts alone', () => {
    expect(key('f', { metaKey: true })).toBeNull();
    expect(key('k', { ctrlKey: true })).toBeNull();
    expect(key('ArrowLeft', { altKey: true })).toBeNull();
    expect(key('Tab')).toBeNull();
  });

  it('leaves typing in a field alone', () => {
    expect(key('k', { target: { tag: 'INPUT' } })).toBeNull();
    expect(key(' ', { target: { tag: 'TEXTAREA' } })).toBeNull();
    expect(key('m', { target: { tag: 'DIV', editable: true } })).toBeNull();
  });

  it('lets a focused button take its own space and enter', () => {
    expect(key(' ', { target: { tag: 'BUTTON' } })).toBeNull();
    expect(key('k', { target: { tag: 'BUTTON' } })).toEqual({ type: 'toggle' });
  });

  it('lets the seek and volume sliders and the menus keep their arrows', () => {
    expect(key('ArrowRight', { target: { tag: 'SPAN', role: 'slider' } })).toBeNull();
    expect(key('Home', { target: { tag: 'SPAN', role: 'slider' } })).toBeNull();
    expect(key('ArrowDown', { target: { tag: 'DIV', role: 'menuitemradio' } })).toBeNull();
    expect(key('m', { target: { tag: 'SPAN', role: 'slider' } })).toEqual({ type: 'mute' });
  });

  it('leaves every key to an open menu, whose letters jump to its items', () => {
    expect(key('m', { target: { tag: 'DIV', role: 'menuitemradio' } })).toBeNull();
    expect(key('k', { target: { tag: 'DIV', role: 'menu' } })).toBeNull();
  });
});

describe('controlsShown', () => {
  const playing = {
    playing: true,
    idle: true,
    keyboardFocus: false,
    menuOpen: false,
    scrubbing: false,
    blocked: false,
  };

  it('hides the controls once a playing film has sat idle', () => {
    expect(controlsShown(playing)).toBe(false);
  });

  it('shows them whenever the film is not playing', () => {
    expect(controlsShown({ ...playing, playing: false })).toBe(true);
  });

  it('shows them while the pointer moves, a key focuses them, a menu is open or the bar is dragged', () => {
    expect(controlsShown({ ...playing, idle: false })).toBe(true);
    expect(controlsShown({ ...playing, keyboardFocus: true })).toBe(true);
    expect(controlsShown({ ...playing, menuOpen: true })).toBe(true);
    expect(controlsShown({ ...playing, scrubbing: true })).toBe(true);
  });

  it('keeps them up while the film is loading or failed', () => {
    expect(controlsShown({ ...playing, blocked: true })).toBe(true);
  });
});

describe('fullscreenPlan', () => {
  const none = { active: false, containerSupported: false, videoSupported: false };

  it('exits when the player is already fullscreen', () => {
    expect(fullscreenPlan({ ...none, active: true, containerSupported: true })).toBe('exit');
  });

  it('takes the whole player fullscreen where the API allows, so the controls come along', () => {
    expect(fullscreenPlan({ ...none, containerSupported: true, videoSupported: true })).toBe('container');
  });

  it("falls back to the video's own fullscreen on iOS Safari", () => {
    expect(fullscreenPlan({ ...none, videoSupported: true })).toBe('video');
  });

  it('does nothing where neither is available', () => {
    expect(fullscreenPlan(none)).toBe('none');
  });
});
