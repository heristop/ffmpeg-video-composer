import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function tone(seconds: number): string[] {
  return ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`];
}

/**
 * The two kinds of `.mp3` that are more than a bare MP3 stream: an MP4 container holding MP3 audio (pop.mp3
 * and point-being.mp3 in the bundled library), and an MP3 whose ID3 tag carries a PNG cover, which demuxes
 * as an attached-picture video stream (any user upload with embedded art).
 * Suites generate them as a 440 Hz tone, since the library's own are tracked files.
 */
export const MUSIC_TRACK_FORMATS = [
  {
    format: 'an MP4 container',
    name: 'boxed-tone',
    args: (seconds: number) => [...tone(seconds), '-c:a', 'libmp3lame', '-f', 'mp4'],
  },
  {
    format: 'an MP3 carrying a cover image',
    name: 'cover-tone',
    // A one-frame source: capping an endless one with `-frames:v 1` ends the whole file after one frame.
    args: (seconds: number) => [
      ...tone(seconds),
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=32x32:d=0.04',
      '-map',
      '0:a',
      '-map',
      '1:v',
      '-c:a',
      'libmp3lame',
      '-c:v',
      'png',
      '-disposition:v',
      'attached_pic',
    ],
  },
] as const;

export async function writeMusicTrack(filePath: string, args: readonly string[]): Promise<void> {
  await execFileAsync('ffmpeg', ['-v', 'error', ...args, filePath]);
}
