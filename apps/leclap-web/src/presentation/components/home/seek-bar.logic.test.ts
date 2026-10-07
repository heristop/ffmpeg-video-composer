import { describe, expect, it } from 'vitest';
import { formatClock, keySeekTarget, pointerTime } from './seek-bar.logic';

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

  it('reads an unknown duration as zero', () => {
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('keySeekTarget', () => {
  it('steps five seconds with the arrows, clamped to the film', () => {
    expect(keySeekTarget('ArrowRight', 10, 60)).toBe(15);
    expect(keySeekTarget('ArrowUp', 58, 60)).toBe(60);
    expect(keySeekTarget('ArrowLeft', 3, 60)).toBe(0);
    expect(keySeekTarget('ArrowDown', 10, 60)).toBe(5);
  });

  it('jumps a tenth with Page Up / Page Down, and to the ends with Home / End', () => {
    expect(keySeekTarget('PageUp', 10, 100)).toBe(20);
    expect(keySeekTarget('PageDown', 10, 100)).toBe(0);
    expect(keySeekTarget('Home', 42, 100)).toBe(0);
    expect(keySeekTarget('End', 42, 100)).toBe(100);
  });

  it('ignores other keys', () => {
    expect(keySeekTarget('Enter', 10, 100)).toBeNull();
  });
});

describe('pointerTime', () => {
  it('maps a pointer x across the track to a time, clamped', () => {
    const track = { left: 100, width: 400 };

    expect(pointerTime(300, track, 60)).toBe(30);
    expect(pointerTime(50, track, 60)).toBe(0);
    expect(pointerTime(900, track, 60)).toBe(60);
  });
});
