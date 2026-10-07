/**
 * Unit tests for the pure media-step helpers.
 * `resolveMusicChoice` / `resolveBackgroundChoice` depend on `expo-asset` (needs
 * Metro + native modules) and are integration-tested at runtime; only the framework-
 * independent `needsMediaStep` is covered here.
 */

import { needsMediaStep } from './mediaStepHelpers';

describe('needsMediaStep', () => {
  it('returns false when global is undefined', () => {
    expect(needsMediaStep()).toBe(false);
  });

  it('returns false when global has no media options', () => {
    expect(needsMediaStep({})).toBe(false);
  });

  it('returns false when allowedMusic is an empty array', () => {
    expect(needsMediaStep({ allowedMusic: [] })).toBe(false);
  });

  it('returns false when allowedBackgrounds is an empty array', () => {
    expect(needsMediaStep({ allowedBackgrounds: [] })).toBe(false);
  });

  it('returns true when allowedMusic contains at least one id', () => {
    expect(needsMediaStep({ allowedMusic: ['point-being'] })).toBe(true);
  });

  it('returns true when allowedBackgrounds contains at least one id', () => {
    expect(needsMediaStep({ allowedBackgrounds: ['forest-sea'] })).toBe(true);
  });

  it('returns true when allowUploadMusic is true', () => {
    expect(needsMediaStep({ allowUploadMusic: true })).toBe(true);
  });

  it('returns true when allowUploadBackground is true', () => {
    expect(needsMediaStep({ allowUploadBackground: true })).toBe(true);
  });

  it('returns true when both music and background options are present', () => {
    expect(
      needsMediaStep({
        allowedMusic: ['lofi-cafe', 'once-in-paris'],
        allowUploadMusic: true,
        allowedBackgrounds: ['forest-sea'],
        allowUploadBackground: false,
      })
    ).toBe(true);
  });

  it('returns false when allowUploadMusic is false and allowedMusic is empty', () => {
    expect(needsMediaStep({ allowUploadMusic: false, allowedMusic: [] })).toBe(false);
  });
});
