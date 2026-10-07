import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { CUSTOM_EASING, easingChoice, easingLabel, easingOptions } from './easingOptions';

const t = ((key: string) => key) as unknown as TFunction<'admin'>;

describe('easing options', () => {
  it('offers the four presets for preset or unset easings', () => {
    expect(easingOptions(t, undefined).map((option) => option.value)).toEqual([
      'linear',
      'ease-out',
      'ease-in-out',
      'ease-out-back',
    ]);
    expect(easingChoice(undefined)).toBe('linear');
    expect(easingChoice('ease-out-back')).toBe('ease-out-back');
  });

  it('shows an authored motion-system curve as its own selected segment, labelled with its spec', () => {
    const options = easingOptions(t, 'spring(300, 14)');

    expect(options.at(-1)).toEqual({ value: CUSTOM_EASING, label: 'spring(300, 14)' });
    expect(easingChoice('spring(300, 14)')).toBe(CUSTOM_EASING);
    expect(easingLabel(t, '$snappy')).toBe('$snappy');
    expect(
      easingLabel(t, {
        points: [
          [0, 0],
          [0.5, 1.1],
          [1, 1],
        ],
      })
    ).toBe('points(3)');
    expect(easingLabel(t, 'ease-out')).toBe('reveal.easingEaseOut');
  });
});
