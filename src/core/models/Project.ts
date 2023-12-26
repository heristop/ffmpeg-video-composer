import { singleton } from 'tsyringe';
import { ProjectBuildInfos, ProjectConfig } from '../types';
import defaultConfig from '../default.config';

@singleton()
class Project {
  public config: ProjectConfig;
  public buildInfos: ProjectBuildInfos;
  public finalVideo: string = '';
  public progress: number = 0;
  public errors: string[] = [];

  constructor() {
    this.init();
  }

  init = (): void => {
    this.buildInfos = {
      totalSegments: 0,
      totalLength: 0,
      currentLength: 0,
      currentProgress: 0,
      currentIncrement: 0,
      durations: [],
      videoInputs: [],
      musicInputs: [],
      musicFilters: [],
      fileConcatPath: '',
      musicPath: '',
    };
  };

  applyDefault = () => {
    this.config = {
      codecConfig: {
        videoCodec: defaultConfig.VIDEO_CODEC,
        audioCodec: defaultConfig.AUDIO_CODEC,
        ...this.config.codecConfig,
      },
      hardwareConfig: {
        hwaccel: defaultConfig.HWACCEL,
        preset: defaultConfig.PRESET,
        ...this.config.hardwareConfig,
      },
      audioConfig: {
        sampleRate: defaultConfig.SAMPLE_RATE,
        channelLayout: defaultConfig.CHANNEL_LAYOUT,
        ...this.config.audioConfig,
      },
      videoConfig: {
        orientation: defaultConfig.ORIENTATION,
        scale: defaultConfig.SCALE,
        setsar: defaultConfig.SETSAR,
        ...this.config.videoConfig,
      },
      currentLocale: this.config.currentLocale ?? defaultConfig.CURRENT_LOCALE,
      ...this.config,
    };
  };

  clean = (): void => this.init();
}

export default Project;
