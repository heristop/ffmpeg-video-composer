// Picture-in-Picture, as plain functions: the player's video in a small floating window that stays on top while the
// visitor does something else. The standard API (`requestPictureInPicture`) covers Chrome, Edge and Safari; older
// Safari and iOS have their presentation mode (`webkitSetPresentationMode`). Firefox offers its own overlay toggle
// but no API, so the button hides there, as it does for a video that sets `disablePictureInPicture`. A local render
// (a blob: URL) floats as well as any other video, and the window never touches the sound: a muted video stays muted.

export type PipSupport = 'standard' | 'webkit' | 'none';

export interface PipSnapshot {
  support: PipSupport;
  /** The video is in its floating window now. */
  active: boolean;
}

/** The slice of `document` the player uses for Picture-in-Picture. */
export interface PipDocument {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Promise<void>;
}

// A video as browsers really ship it: Safari's presentation mode is not in the DOM types.
type PipVideo = HTMLVideoElement & {
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
};

const PIP = 'picture-in-picture';

/** Which Picture-in-Picture the browser offers for this video. */
export function pipSupport({
  standard,
  webkit,
  disabled,
}: {
  standard: boolean;
  webkit: boolean;
  disabled: boolean;
}): PipSupport {
  if (disabled) return 'none';

  if (standard) return 'standard';

  return webkit ? 'webkit' : 'none';
}

const supportOf = (video: PipVideo, doc: PipDocument): PipSupport =>
  pipSupport({
    standard: doc.pictureInPictureEnabled === true && typeof video.requestPictureInPicture === 'function',
    webkit: video.webkitSupportsPresentationMode?.(PIP) === true,
    disabled: video.disablePictureInPicture,
  });

const isActive = (video: PipVideo, doc: PipDocument): boolean =>
  doc.pictureInPictureElement === video || video.webkitPresentationMode === PIP;

const EVENTS = ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged'] as const;

/**
 * Follows a video into and out of its floating window, reporting the support and the state to `onChange` (once at
 * once, then on every change). Returns the function that stops watching.
 */
export function watchPip(video: HTMLVideoElement, doc: PipDocument, onChange: (snapshot: PipSnapshot) => void) {
  const pipVideo: PipVideo = video;
  const support = supportOf(pipVideo, doc);
  const report = (active: boolean) => {
    onChange({ support, active });
  };

  report(support !== 'none' && isActive(pipVideo, doc));

  if (support === 'none') return () => {};

  const listeners: Record<(typeof EVENTS)[number], () => void> = {
    enterpictureinpicture: () => {
      report(true);
    },
    leavepictureinpicture: () => {
      report(false);
    },
    webkitpresentationmodechanged: () => {
      report(pipVideo.webkitPresentationMode === PIP);
    },
  };

  for (const name of EVENTS) pipVideo.addEventListener(name, listeners[name]);

  return () => {
    for (const name of EVENTS) pipVideo.removeEventListener(name, listeners[name]);
  };
}

/** Opens the video's floating window, or closes it if it is open. */
export function togglePip(video: HTMLVideoElement, doc: PipDocument): void {
  const pipVideo: PipVideo = video;
  const support = supportOf(pipVideo, doc);

  if (support === 'standard') {
    const request = isActive(pipVideo, doc) ? doc.exitPictureInPicture?.() : pipVideo.requestPictureInPicture();

    request?.catch(() => {});

    return;
  }

  if (support === 'webkit') pipVideo.webkitSetPresentationMode?.(isActive(pipVideo, doc) ? 'inline' : PIP);
}
