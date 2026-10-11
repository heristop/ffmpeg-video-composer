import { describe, expect, it, vi } from 'vitest';
import { pipSupport, togglePip, watchPip, type PipDocument, type PipSnapshot } from './pip.logic';

describe('pipSupport', () => {
  it('prefers the standard Picture-in-Picture API', () => {
    expect(pipSupport({ standard: true, webkit: true, disabled: false })).toBe('standard');
  });

  it('falls back to Safari’s presentation mode', () => {
    expect(pipSupport({ standard: false, webkit: true, disabled: false })).toBe('webkit');
  });

  it('has nothing in Firefox, or where the video opts out', () => {
    expect(pipSupport({ standard: false, webkit: false, disabled: false })).toBe('none');
    expect(pipSupport({ standard: true, webkit: true, disabled: true })).toBe('none');
  });
});

// A video double: an EventTarget with the standard request, Safari's presentation mode, and the opt-out flag.
class FakeVideo extends EventTarget {
  disablePictureInPicture = false;
  muted = true;
  webkitPresentationMode = 'inline';
  requestPictureInPicture = vi.fn(() => Promise.resolve({}));
  webkitSetPresentationMode = vi.fn((mode: string) => {
    this.webkitPresentationMode = mode;
    this.dispatchEvent(new Event('webkitpresentationmodechanged'));
  });
  webkitSupportsPresentationMode = (mode: string) => mode === 'picture-in-picture';
}

const pipDocument = (enabled: boolean): PipDocument & { exitPictureInPicture: ReturnType<typeof vi.fn> } => ({
  pictureInPictureEnabled: enabled,
  pictureInPictureElement: null,
  exitPictureInPicture: vi.fn(() => Promise.resolve()),
});

const asVideo = (video: FakeVideo) => video as unknown as HTMLVideoElement;

describe('watchPip', () => {
  it('follows the video into and out of its picture-in-picture window', () => {
    const video = new FakeVideo();
    const seen: PipSnapshot[] = [];
    const stop = watchPip(asVideo(video), pipDocument(true), (snapshot) => seen.push(snapshot));

    video.dispatchEvent(new Event('enterpictureinpicture'));
    video.dispatchEvent(new Event('leavepictureinpicture'));
    stop();
    video.dispatchEvent(new Event('enterpictureinpicture'));

    expect(seen).toEqual([
      { support: 'standard', active: false },
      { support: 'standard', active: true },
      { support: 'standard', active: false },
    ]);
  });

  it('follows Safari’s presentation mode where the standard API is missing', () => {
    const video = new FakeVideo();
    const seen: PipSnapshot[] = [];

    watchPip(asVideo(video), pipDocument(false), (snapshot) => seen.push(snapshot));
    video.webkitSetPresentationMode('picture-in-picture');

    expect(seen.at(-1)).toEqual({ support: 'webkit', active: true });
  });

  it('reports no support where the video opts out', () => {
    const video = new FakeVideo();
    const seen: PipSnapshot[] = [];

    video.disablePictureInPicture = true;
    watchPip(asVideo(video), pipDocument(true), (snapshot) => seen.push(snapshot));

    expect(seen).toEqual([{ support: 'none', active: false }]);
  });
});

describe('togglePip', () => {
  it('opens the window, and closes it again, without touching the sound', () => {
    const video = new FakeVideo();
    const doc = pipDocument(true);

    togglePip(asVideo(video), doc);
    expect(video.requestPictureInPicture).toHaveBeenCalledOnce();

    doc.pictureInPictureElement = asVideo(video);
    togglePip(asVideo(video), doc);
    expect(doc.exitPictureInPicture).toHaveBeenCalledOnce();
    expect(video.muted).toBe(true);
  });

  it('switches Safari’s presentation mode in and out', () => {
    const video = new FakeVideo();
    const doc = pipDocument(false);

    togglePip(asVideo(video), doc);
    expect(video.webkitPresentationMode).toBe('picture-in-picture');

    togglePip(asVideo(video), doc);
    expect(video.webkitPresentationMode).toBe('inline');
  });

  it('does nothing where picture-in-picture is unavailable', () => {
    const video = new FakeVideo();

    video.disablePictureInPicture = true;
    togglePip(asVideo(video), pipDocument(true));

    expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    expect(video.webkitSetPresentationMode).not.toHaveBeenCalled();
  });
});
