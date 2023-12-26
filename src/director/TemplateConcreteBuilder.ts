import { inject, injectable } from 'tsyringe';
import AbstractLogger from '../platform/logging/AbstractLogger';
import AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import { Section } from '@/core/types';
import Project from '../core/models/Project';
import SegmentFactory from '../editor/factories/SegmentFactory';
import SegmentBuilder from '../editor/SegmentBuilder';

@injectable()
class TemplateConcreteBuilder {
  private section: Section;
  private segment: SegmentBuilder;

  constructor(
    private readonly project: Project,

    @inject('logger') private readonly logger: AbstractLogger,
    @inject('ffmpegAdapter') private readonly ffmpegAdapter: AbstractFFmpeg,
    @inject('filesystemAdapter') private readonly filesystemAdapter: AbstractFilesystem
  ) {}

  buildPart = async (section: Section): Promise<boolean> => {
    this.section = section;
    this.segment = new SegmentFactory().create(section);

    if (!this.segment) {
      this.logger.error(`[${section.name}][BuildPart] create section`);
      return false;
    }

    this.project.finalVideo = `${this.filesystemAdapter.getBuildDir()}/output.mp4`;
    this.logger.info(`[${section.name}][BuildPart] init`);

    return await this.segment.init();
  };

  /**
   * RenderPart: execute FFmpeg
   */
  renderPart = async (): Promise<void> => {
    const command = this.segment.getCommand();

    if (!command) {
      this.logger.info(`[${this.section.name}][RenderPart] No command available`);
    }

    this.logger.debug(`[${this.section.name}][Command] ffmpeg ${command}`);

    const result = await this.ffmpegAdapter.execute(command);
    this.logger.info(`[${this.section.name}][RenderPart] ffmpeg process exited with rc ${result.rc}`);

    if (result.rc === 1) {
      this.project.errors.push(this.section.name);
    }

    this.logger.info(`[${this.section.name}][RenderPart] finalized`);
  };
}

export default TemplateConcreteBuilder;
