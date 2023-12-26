import { inject, injectable } from 'tsyringe';
import { Section } from '@/core/types';
import AbstractLogger from '../platform/logging/AbstractLogger';
import AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import AbstractMusic from '../platform/ffmpeg/AbstractMusic';
import { fancyTimeFormat } from '../core/helpers/FormatHelper';
import Template from '../core/models/Template';
import Project from '../core/models/Project';

@injectable()
class MusicComposer {
  private buildAssetsDir: string;
  private musicAssetsDir: string;

  constructor(
    private readonly project: Project,
    private readonly template: Template,

    @inject('logger') private readonly logger: AbstractLogger,
    @inject('ffmpegAdapter') private readonly ffmpegAdapter: AbstractFFmpeg,
    @inject('filesystemAdapter')
    private readonly filesystemAdapter: AbstractFilesystem,
    @inject('musicAdapter') private readonly musicAdapter: AbstractMusic
  ) {}

  loadMusic = async (): Promise<void> => {
    this.buildAssetsDir = await this.filesystemAdapter.getBuildPath('assets');
    this.musicAssetsDir = await this.filesystemAdapter.getAssetsPath('musics');

    if (!this.project.config.music) {
      // Use template music
      if (this.template.descriptor.global?.music) {
        this.project.config.music = this.template.descriptor.global.music;
      }

      // Add a default music
      if (!this.project.config.music) {
        this.project.config = {
          ...this.project.config,
          music: {
            name: 'silence-1-min.mp3',
          },
        };
      }
    }

    const musicName = this.project.config.music.name;
    const musicFormattedName = this.formatMusicName(musicName.substring(0, musicName.lastIndexOf('.')));
    const destination = `${this.buildAssetsDir}/${musicFormattedName}.mp3`;
    const musicPathInCache = `${this.musicAssetsDir}/${musicFormattedName}.mp3`;

    if (await this.checkMusicExists(musicPathInCache)) {
      this.logger.info(`[Music] Loaded from cache ${musicPathInCache}`);
      this.project.buildInfos.musicPath = musicPathInCache;
    } else if (this.project.config.music.url) {
      this.logger.info(`[Music] Fetching ${this.project.config.music.url}`);
      await this.downloadAndSaveMusic(this.project.config.music.url, destination);
      this.project.buildInfos.musicPath = destination;
    } else {
      throw new Error('Music URL is not provided.');
    }
  };

  private async downloadAndSaveMusic(url: string, destination: string): Promise<void> {
    const musicPath = await this.downloadMusic(url);

    await this.filesystemAdapter.move(musicPath, destination);

    this.logger.info(`[Music] Fetched ${destination}`);
  }

  private async downloadMusic(url: string): Promise<string> {
    return await this.filesystemAdapter.fetch(url);
  }

  private formatMusicName(name: string): string {
    return name.replace(/[:.' ]/g, '_').toLowerCase();
  }

  private async checkMusicExists(filePath: string): Promise<boolean> {
    return await this.filesystemAdapter.stat(filePath);
  }

  prepareMusicTrack = (section: Section): void => {
    const sectionData = this.template.descriptor[section.name];

    // Apply default values
    let musicVolumeLevel = 0.5;
    let transitionDuration = 0.3;

    if (!this.project.buildInfos.currentLength) {
      this.project.buildInfos.currentLength = 0.0;
    }

    if (section.options.musicVolumeLevel) {
      musicVolumeLevel = section.options.musicVolumeLevel;
    }

    if (this.template.descriptor.global.transitionDuration) {
      transitionDuration = this.template.descriptor.global.transitionDuration;
    }

    let duration = 0;

    if (section.type === 'project_video' && sectionData?.info) {
      // Retrieve video duration from info
      duration = this.project.buildInfos.durations[section.name];
    } else if (section.options.duration) {
      // Or retrieve from template config
      duration = section.options.duration;
    }

    const sectionIncrement = this.project.buildInfos.currentIncrement + 1;
    const isFirstSection = sectionIncrement === 1;
    const isLastSection = sectionIncrement == this.project.buildInfos.totalSegments;
    const mapName = isLastSection ? 'lastsection' : `section${sectionIncrement}`;

    this.project.buildInfos.currentIncrement = sectionIncrement;

    let tCmd = '';
    let ssCmd = '';
    const ss = this.project.buildInfos.currentLength;
    let t = duration;

    if (ss > 0) {
      ssCmd = ` -ss ${fancyTimeFormat(ss * 1000, true, true)} `;
    }

    t += transitionDuration;

    tCmd = ` -t ${fancyTimeFormat(t * 1000, true, true)} `;
    this.project.buildInfos.currentLength += duration;
    this.project.buildInfos.musicInputs.push(` ${ssCmd} ` + ` ${tCmd} ` + ` -i ${this.project.buildInfos.musicPath} `);

    let filterConfig = '';

    if (isFirstSection) {
      // Fade in first audio section
      filterConfig = `afade=t=in:ss=0:d=${transitionDuration},`;
    } else if (isLastSection) {
      // Fade out last audio section
      filterConfig = `afade=t=out:st=${duration - transitionDuration}:d=${transitionDuration},`;
    }

    filterConfig += `volume=${musicVolumeLevel}`;
    this.project.buildInfos.musicFilters.push(` [${sectionIncrement}:a]${filterConfig}[${mapName}]; `);

    // Add accrossfade effect "Mix DJ style" between 2 sections
    if (sectionIncrement > 1) {
      const acrossfadeConfig = `acrossfade=d=${transitionDuration}:c1=tri:c2=tri`;
      let acrossfadeMapName = '';

      if (isLastSection === false) {
        acrossfadeMapName = `crossed${sectionIncrement - 1}`;
      } else {
        acrossfadeMapName = 'lastcrossed';
      }

      let previousMapName = '';

      if (sectionIncrement === 2) {
        previousMapName = `section${sectionIncrement - 1}`;
      } else {
        previousMapName = `crossed${sectionIncrement - 2}`;
      }

      if (acrossfadeConfig) {
        this.project.buildInfos.musicFilters.push(
          ` [${previousMapName}][${mapName}]${acrossfadeConfig}[${acrossfadeMapName}]; `
        );
      }
    }
  };

  /**
   * Loop music if length is lt than video length
   */
  loopMusic = async (): Promise<void> => {
    const { totalLength, musicPath } = this.project.buildInfos;

    await this.musicAdapter.process(this.logger, this.filesystemAdapter, totalLength, musicPath);
  };

  /**
   * Append music of option is enabled
   */
  appendMusic = async (segments: Section[], finalVideo: string): Promise<void> => {
    const time = new Date().getTime();
    const temp = `${this.filesystemAdapter.getTempDir()}/tmp_video_${time}.mp4`;
    const reduceNoiseConfig = 'afftdn=nr=20:nf=-20';

    // Default audio volume level
    const audioVolumeLevel = this.template.descriptor.global.audioVolumeLevel || 1;
    const sampleRate = this.project.config.audioConfig.sampleRate;

    await this.filesystemAdapter.move(finalVideo, temp);

    // Audio channel configuration
    const channelConfig = `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=stereo`;

    // Building the FFmpeg command
    let command = ` -y -i ${temp} ${this.project.buildInfos.musicInputs.join(' ')} `;
    let filterComplex = `[0:a]${channelConfig},volume=${audioVolumeLevel},${reduceNoiseConfig},apad[audio_formatted]; `;

    // Check if there are multiple segments and if music should be mixed
    if (segments.length > 1) {
      filterComplex += `   ${this.project.buildInfos.musicFilters.join(' ')} `;
      filterComplex += `   [lastcrossed]${channelConfig}[music_formatted]; `;
      filterComplex += '   [audio_formatted][music_formatted]amix=inputs=2[final]';
    } else {
      filterComplex += ` [1:a]${channelConfig}[music_formatted]; `;
      filterComplex += ` [audio_formatted][music_formatted]amix=inputs=2[final]`;
    }

    // Completing the command
    command += ` -filter_complex "${filterComplex}" `;
    command += ` -map 0:v -map "[final]" -c:v copy -c:a aac -ac 2 -shortest ${finalVideo} `;

    this.logger.debug(`[Music][Command] ffmpeg ${command}`);
    const result = await this.ffmpegAdapter.execute(command);
    this.logger.info(`[Music] ffmpeg process exited with rc ${result.rc}`);

    if (result.rc === 1) {
      throw new Error('Error on music add');
    }

    // Clean up the temporary file
    await this.filesystemAdapter.unlink(temp);
  };
}

export default MusicComposer;
