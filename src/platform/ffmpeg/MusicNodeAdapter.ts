import { injectable } from 'tsyringe';
import fs from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
import AbstractLogger from '../logging/AbstractLogger';
import AbstractFilesystem from '../filesystem/AbstractFilesystem';
import AbstractMusic from './AbstractMusic';

@injectable()
class MusicNodeAdapter implements AbstractMusic {
  process = async (
    logger: AbstractLogger,
    filesystemAdapter: AbstractFilesystem,
    totalLength: number = 0,
    musicPath: string
  ): Promise<{ rc: number }> => {
    const musicInfo = await ffprobe(musicPath, { path: ffprobeStatic.path });
    const musicLength = parseFloat(musicInfo.streams[0].duration);

    logger.info(`[Music] Duration: ${musicLength} / ${totalLength}`);

    if (musicLength < totalLength) {
      const loop = `${filesystemAdapter.getBuildDir()}/loop_music.mp4`;

      let input = `concat:${musicPath}`;
      let i = 1;

      while (i * musicLength < totalLength) {
        input += `|${musicPath}`;
        i++;
      }

      const command = `-y -i "${input}" -acodec copy ${loop}`;
      logger.info(`[Music][Command] ffmpeg ${command}`);

      const result: { rc: number } = await new Promise((resolve, reject) => {
        ffmpeg.setFfmpegPath(ffmpegStatic);
        ffmpeg()
          .input(input)
          .audioCodec('copy')
          .output(loop)
          .on('error', (err) => reject(err))
          .on('end', () => resolve({ rc: 0 }))
          .run();
      });

      if (result.rc === 1) {
        throw new Error(`Failed command: ffmpeg ${command}`);
      }

      await fs.unlink(musicPath);
      await fs.rename(loop, musicPath);

      logger.info(`[Music][Loop] ffmpeg process exited with rc ${result.rc}`);

      return result;
    }
  };
}

export default MusicNodeAdapter;
