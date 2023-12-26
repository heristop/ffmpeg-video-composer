import EventEmitter from 'events';
import { inject, injectable } from 'tsyringe';
import AbstractLogger from '../platform/logging/AbstractLogger';
import AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import Template from '../core/models/Template';
import Project from '../core/models/Project';
import { Section } from '@/core/types';
import MusicComposer from './MusicComposer';

@injectable()
class VideoEditor {
  public emitter: EventEmitter;

  constructor(
    private readonly project: Project,
    private readonly template: Template,
    private readonly musicComposer: MusicComposer,

    @inject('logger') private readonly logger: AbstractLogger,
    @inject('ffmpegAdapter') private readonly ffmpegAdapter: AbstractFFmpeg,
    @inject('filesystemAdapter')
    private readonly filesystemAdapter: AbstractFilesystem
  ) {}

  concat = async (): Promise<void> => {
    const fileList = await this.filesystemAdapter.read(this.project.buildInfos.fileConcatPath);
    const files = fileList.split('\n').filter(Boolean);

    if (files.length === 1) {
      await this.filesystemAdapter.copy(files[0].replace('file ', ''), this.project.finalVideo);
      this.logger.info(`[Concat][Command] Copied single file to ${this.project.finalVideo}`);
    } else {
      const command =
        ' -y -vsync 2 -r 30 -f concat -safe 0 -auto_convert 1 ' +
        ` -i ${this.project.buildInfos.fileConcatPath} ` +
        ` -c copy -movflags +faststart ${this.project.finalVideo} `;
      this.logger.debug(`[Concat][Command] ffmpeg ${command}`);

      const result = await this.ffmpegAdapter.execute(command);
      this.logger.info(`[Concat] ffmpeg process exited with rc ${result.rc}`);

      if (result.rc === 1) {
        this.project.errors.push('concat');
        throw new Error('[Concat] Errors on concatenation');
      }
    }
  };

  /**
   * Attach mounted video to the current project
   */
  finalize = async (segments: Section[]): Promise<void> => {
    // Append music if option is enabled
    if (this.template.descriptor.global.musicEnabled) {
      await this.musicComposer.loopMusic();

      await this.musicComposer.appendMusic(segments, this.project.finalVideo);
    }

    // Finalize only if no errors had been rejected
    if (this.project.errors.length === 0) {
      // Call event
      this.emitter.emit('finalize', {
        video_source: this.project.finalVideo,
        template_assets: this.template.assets,
      });

      // Delete concatenation file
      await this.filesystemAdapter.unlink(this.project.buildInfos.fileConcatPath);

      this.emitter.emit('compilation-progress', 1);
      this.logger.info('[End] project cleaned');

      this.project.clean();
      this.template.clean();
    }
  };
}

export default VideoEditor;
