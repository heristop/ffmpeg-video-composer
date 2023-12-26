import SegmentBuilder from '../SegmentBuilder';

class Video extends SegmentBuilder {
  configure = (): void => {
    this.command = ` -y ${this.addBlankAudio()} `;

    // Is there a mute option?
    if (false === this.section.options.muteSection) {
      this.command = ' -y ';
    }

    this.filters += ' -map 0:a ';

    if (this.section.options.videoUrl) {
      // Use a video as second input
      this.command +=
        ` ${this.hwaccelArg} ${this.sources.join(' ')} ` +
        ` -r 30 -t ${this.section.options.duration} ` +
        ` -c:v h264 -c:a aac -ac 2 -pix_fmt yuv420p -crf 23 -b:v 12M -profile:v high -movflags +faststart -preset ${this.project.config.hardwareConfig.preset} ` +
        ` ${this.filters} ${this.destination} `;

      return;
    }

    if (this.section.options.useVideoSection) {
      // Use a project video as second input
      const videoSegment = this.section.options.useVideoSection;
      const sourceVideo = `-i ${this.filesystemAdapter.getSource(videoSegment)}`;

      this.command +=
        ` ${this.hwaccelArg} ${sourceVideo} ${this.sources.join(' ')} ` +
        ` -r 30 -t ${this.section.options.duration} ` +
        ` -c:v h264 -c:a aac -ac 2 -pix_fmt yuv420p -crf 23 -b:v 12M -profile:v high -movflags +faststart -preset ${this.project.config.hardwareConfig.preset} ` +
        ` ${this.filters} ${this.destination} `;
    }
  };
}

export default Video;
