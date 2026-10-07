import fs from 'node:fs';
import path from 'node:path';
import type { FFMpegInfos } from '@/core/types';
import AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { parseCommand } from '@/platform/ffmpeg/parse-command';

/**
 * An FFmpeg adapter that runs nothing: each command writes an empty file at its output path (so the
 * director's existence checks pass) and every probe reports a fixed clip. Compiling through it yields the
 * exact command set the engine would run, with no media and in milliseconds, which is what the
 * filtergraph goldens snapshot.
 */
export class DryRunFFmpeg extends AbstractFFmpeg {
  constructor(
    private readonly probe: FFMpegInfos = { duration: 5, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 44100 }
  ) {
    super();
  }

  execute = (command: string): Promise<{ rc: number }> => {
    const output = parseCommand(command).at(-1);

    if (output && output !== '-version') {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, '');
    }

    return Promise.resolve({ rc: 0 });
  };

  getInfos = (): Promise<FFMpegInfos> => Promise.resolve({ ...this.probe });
}
