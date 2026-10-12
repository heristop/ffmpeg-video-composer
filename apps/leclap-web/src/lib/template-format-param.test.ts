import { describe, expect, it } from 'vitest';
import { templateFormatParam } from './template-format-param';

describe('templateFormatParam', () => {
  it('reads a format the engine renders', () => {
    expect(templateFormatParam('portrait')).toBe('portrait');
    expect(templateFormatParam('landscape')).toBe('landscape');
    expect(templateFormatParam('square')).toBe('square');
  });

  it('leaves the template in its own format for a missing or unknown value', () => {
    expect(templateFormatParam(null)).toBeUndefined();
    expect(templateFormatParam('')).toBeUndefined();
    expect(templateFormatParam('vertical')).toBeUndefined();
  });
});
