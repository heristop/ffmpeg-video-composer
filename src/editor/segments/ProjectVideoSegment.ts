import SegmentBuilder from '../SegmentBuilder';

class ProjectVideo extends SegmentBuilder {
  configure = (): void => {
    this.command = ' -y ';

    // Is there a mute option?
    if (true === this.section.options.muteSection) {
      this.command = ` -y ${this.addBlankAudio()} `;
    }

    const sourceVideo = `-i ${this.source}`;

    let duration = '';

    if (this.section.options.duration > 0) {
      duration = ` -t ${this.section.options.duration} `;
    }

    this.command +=
      ` ${this.hwaccelArg} ${sourceVideo} ${this.sources.join(' ')} ` +
      ` -r 30 ${duration} ` +
      ` -c:v h264 -c:a aac -ac 2 -pix_fmt yuv420p -crf 23 -tune film -b:v 12M -profile:v high -movflags +faststart -shortest -preset ${this.project.config.hardwareConfig.preset} ` +
      ` ${this.filters} -map 0:a ${this.destination} `;
  };
}

export default ProjectVideo;
