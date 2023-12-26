import { exec } from 'child_process';
import { inject, injectable } from 'tsyringe';
import ffmpegStatic from 'ffmpeg-static';
import ffprobe from 'ffprobe';
import ffprobeStatic from 'ffprobe-static';
import { FFMpegInfos } from '@/core/types';
import AbstractLogger from '../logging/AbstractLogger';
import AbstractFFmpeg from './AbstractFFmpeg';

@injectable()
class FFmpegNodeAdapter extends AbstractFFmpeg {
  constructor(@inject('logger') private readonly logger: AbstractLogger) {
    super();
  }

  execute = (command: string): Promise<{ rc: number }> =>
    new Promise((resolve, reject) => {
      exec(ffmpegStatic + command, (error) => {
        if (error) {
          this.logger.error(`Error executing command: ${error}`);

          reject({ rc: 1 });
        }

        resolve({ rc: 0 });
      });
    });

  getInfos = (source: string): Promise<FFMpegInfos> =>
    new Promise((resolve, reject) => {
      ffprobe(source, { path: ffprobeStatic.path })
        .then((info) => {
          const videoStream = info.streams.find((s) => s.codec_type === 'video');
          const audioStream = info.streams.find((s) => s.codec_type === 'audio');

          resolve({
            duration: videoStream ? parseFloat(videoStream.duration) : null,
            videoCodec: videoStream ? videoStream.codec_name : null,
            audioCodec: audioStream ? audioStream.codec_name : null,
            sampleRate: audioStream ? audioStream.sample_rate : null,
          });
        })
        .catch((err) => reject(err));
    });
}

export default FFmpegNodeAdapter;
