import AbstractFilesystem from '../filesystem/AbstractFilesystem';
import AbstractLogger from '../logging/AbstractLogger';

abstract class AbstractMusic {
  abstract process(
    logger: AbstractLogger,
    filesystemAdapter: AbstractFilesystem,
    totalLength: number,
    musicPath: string
  ): Promise<{ rc: number }>;
}

export default AbstractMusic;
