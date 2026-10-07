import { execFile, type ExecException } from 'node:child_process';
import { injectable } from 'tsyringe';
import { promisify } from 'node:util';
import type { FFMpegInfos } from '../../core/types';
import AbstractFFmpeg, { type FFmpegBinaries } from './AbstractFFmpeg';
import { FFmpegError } from '../../core/errors/FFmpegError';
import { reportedTraits } from '../../core/footage/media-traits';
import { parseCommand } from './parse-command';
import { spawnFailure, tailStderr } from './tail-stderr';
import { withFilterScripts } from './filter-scripts-node';
import { measureLoudness } from './analyze-node';
import { getPerfTimer } from '../../utils/perf-timer';

const execFileAsync = promisify(execFile);

interface FFProbeStream {
  codec_type: string;
  codec_name: string | null;
  duration: string;
  sample_rate?: string;
}

interface FFProbeData {
  streams: FFProbeStream[];
}

@injectable()
class FFmpegNodeAdapter extends AbstractFFmpeg {
  // Each execute() spawns an independent ffmpeg child process, so renders can overlap.
  override get supportsConcurrentExecute(): boolean {
    return true;
  }

  // The same PATH lookup execute() and getInfos() use.
  override get binaries(): FFmpegBinaries {
    return { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
  }

  execute = async (command: string): Promise<{ rc: number }> => {
    try {
      // Errors only. At its default level ffmpeg also prints its banner, every input's stream dump, the
      // stream mapping and encoder stats, which bury the line saying why a command failed.
      await getPerfTimer().span('ffmpeg:execute', () =>
        withFilterScripts(['-loglevel', 'error', ...parseCommand(command)], (args) => execFileAsync('ffmpeg', args))
      );

      return { rc: 0 };
    } catch (error) {
      const execError = error as ExecException & { stderr: string };

      // A spawn failure (E2BIG, ENOENT) never reaches FFmpeg, so there is no stderr: report the system
      // error instead. Oversized filtergraphs go through script files (filter-scripts-node.ts).
      throw new FFmpegError('FFmpeg command failed', tailStderr(execError.stderr) || spawnFailure(execError));
    }
  };

  override measureTruePeak = async (file: string): Promise<number | null> =>
    (await measureLoudness('ffmpeg', file)).truePeak;

  getInfos = async (source: string): Promise<FFMpegInfos> => {
    try {
      const { stdout } = await getPerfTimer().span('ffmpeg:getInfos', () =>
        execFileAsync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', source])
      );

      const info: FFProbeData = JSON.parse(stdout);

      const videoStream = info.streams.find((s) => s.codec_type === 'video');
      const audioStream = info.streams.find((s) => s.codec_type === 'audio');
      // WebM/MKV streams often carry no duration (or 'N/A'); parseFloat would yield NaN, which
      // slips past `!== null` checks and defeats the declared-duration fallback downstream.
      const parsedDuration = videoStream ? parseFloat(videoStream.duration) : NaN;

      return {
        duration: Number.isFinite(parsedDuration) ? parsedDuration : null,
        videoCodec: videoStream?.codec_name ?? null,
        audioCodec: audioStream?.codec_name ?? null,
        sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : null,
        ...reportedTraits(videoStream),
      };
    } catch (error) {
      const execError = error as ExecException & { stderr: string };

      throw new FFmpegError(`FFprobe analysis failed for ${source}`, execError.stderr);
    }
  };
}

export default FFmpegNodeAdapter;
