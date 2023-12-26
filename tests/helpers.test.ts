import { fancyTimeFormat } from '@/core/helpers/FormatHelper';

describe('fancyTimeFormat', () => {
  test('formats correctly without hours and milliseconds', () => {
    expect(fancyTimeFormat(90000)).toEqual('01:30'); // 1 minute 30 seconds
  });

  test('formats correctly with hours and without milliseconds', () => {
    expect(fancyTimeFormat(3660000, false, true)).toEqual('01:01:00'); // 1 hour 1 minute
  });

  test('formats correctly with hours and milliseconds', () => {
    expect(fancyTimeFormat(3661500, true, true)).toEqual('01:01:01.5'); // 1 hour 1 minute 1.5 seconds
  });

  test('formats correctly without hours but with milliseconds', () => {
    expect(fancyTimeFormat(90500, true, false)).toEqual('01:30.5'); // 1 minute 30.5 seconds
  });

  test('returns zero format for zero duration', () => {
    expect(fancyTimeFormat(0)).toEqual('00:00');
    expect(fancyTimeFormat(0, false, true)).toEqual('00:00:00');
  });
});
