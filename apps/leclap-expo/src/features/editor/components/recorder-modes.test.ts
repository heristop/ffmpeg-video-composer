import { recorderModes, uploadFallback } from './recorder-modes';

describe('recorderModes', () => {
  it('offers both cameras and an upload when the section sets nothing', () => {
    expect(recorderModes(undefined)).toEqual({ modes: ['front', 'back', 'upload'], initial: 'front' });
  });

  it('starts on the authored capture mode', () => {
    expect(recorderModes({ captureMode: 'upload' })).toEqual({ modes: ['front', 'back', 'upload'], initial: 'upload' });
  });

  it('keeps an authored lock to one mode', () => {
    expect(recorderModes({ allowedCaptureModes: ['upload'] })).toEqual({ modes: ['upload'], initial: 'upload' });
  });

  it('drops screen capture, which the phone recorder does not offer', () => {
    expect(recorderModes({ allowedCaptureModes: ['screen', 'back'] })).toEqual({ modes: ['back'], initial: 'back' });
    expect(recorderModes({ allowedCaptureModes: ['screen'] })).toEqual({
      modes: ['front', 'back', 'upload'],
      initial: 'front',
    });
  });

  it('ignores an authored start mode that is not allowed', () => {
    expect(recorderModes({ captureMode: 'front', allowedCaptureModes: ['back', 'upload'] })).toEqual({
      modes: ['back', 'upload'],
      initial: 'back',
    });
  });
});

describe('uploadFallback', () => {
  it('falls back to the gallery when the camera cannot be used and upload is allowed', () => {
    expect(uploadFallback(['front', 'back', 'upload'], false)).toBe(true);
  });

  it('keeps the camera when it works', () => {
    expect(uploadFallback(['front', 'back', 'upload'], true)).toBe(false);
  });

  it('has nothing to fall back to when the section locks the camera', () => {
    expect(uploadFallback(['back'], false)).toBe(false);
  });
});
