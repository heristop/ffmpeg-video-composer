import { FFMpegInfos } from '@/core/types';

abstract class AbstractFFmpeg {
  abstract execute(command: string): Promise<{ rc: number }>;

  abstract getInfos(source: string): Promise<FFMpegInfos>;
}

export default AbstractFFmpeg;
