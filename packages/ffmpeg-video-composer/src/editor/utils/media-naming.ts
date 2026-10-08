// How a staged media file is named and keyed: the extension of its URL, a name (the input's own, or the
// URL's file stem for frames and nameless media) and the `%d` frame placeholder filled in.

import type { Media } from '@/core/types';

export function extensionFromUrl(url: string): string {
  return url.split('.').pop() ?? '';
}

export function mediaName(media: Media, url: string, frame: number): string {
  if (frame || !media.name) {
    return url
      .substring(url.lastIndexOf('/') + 1)
      .split('.')
      .slice(0, -1)
      .join('.');
  }

  return media.name;
}

export function frameInUrl(url: string, frame: number): string {
  if (frame && url.includes('%d')) {
    const framePattern = /-([0-9]{3}).([a-z]{3})$/;
    const frameString = `00${frame}`.slice(-3);

    return framePattern.test(url) ? url.replace('%d', frameString) : url.replace('%d', `${frame}`);
  }

  return url;
}

export function frameInName(name: string, frame: number): string {
  return frame ? name.replace('%d', `00${frame}`.slice(-3)) : name;
}
