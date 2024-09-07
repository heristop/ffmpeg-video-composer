import PinoLogAdapter from './logging/PinoLogAdapter';
import FFmpegNodeAdapter from './ffmpeg/FFmpegNodeAdapter';
import MusicNodeAdapter from './ffmpeg/MusicNodeAdapter';
import FilesystemNodeAdapter from './filesystem/FilesystemNodeAdapter';

class PlatformBridge {
  create = (adapter: string) => {
    let platform: string;

    if (false === ['logger', 'ffmpeg', 'filesystem', 'music'].includes(adapter)) {
      throw new TypeError(`Wrong adapter: ${adapter}`);
    }

    if (this.isNodeEnvironment()) {
      platform = 'node';
    } else {
      throw new Error('Unsupported platform');
    }

    const classesMapping = {
      logger: { node: PinoLogAdapter },
      ffmpeg: { node: FFmpegNodeAdapter },
      filesystem: { node: FilesystemNodeAdapter },
      music: { node: MusicNodeAdapter },
    };

    return new classesMapping[adapter][platform]();
  };

  isNodeEnvironment = () =>
    typeof globalThis.process !== 'undefined' &&
    globalThis.process.versions != null &&
    globalThis.process.versions.node != null;
}

export default PlatformBridge;
