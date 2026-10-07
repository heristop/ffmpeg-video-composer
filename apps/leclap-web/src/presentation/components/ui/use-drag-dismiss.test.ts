import { describe, expect, it } from 'vitest';
import { shouldDismiss } from './use-drag-dismiss';

describe('bottom sheet drag-to-dismiss', () => {
  it('dismisses past the distance threshold, whatever the speed', () => {
    expect(shouldDismiss(120, 0)).toBe(true);
  });

  it('dismisses on a quick downward flick that has moved', () => {
    expect(shouldDismiss(40, 900)).toBe(true);
  });

  it('springs back on a short, slow drag or a twitch', () => {
    expect(shouldDismiss(40, 100)).toBe(false);
    expect(shouldDismiss(4, 2000)).toBe(false);
    expect(shouldDismiss(0, 0)).toBe(false);
  });
});
