import SegmentBuilder from '../SegmentBuilder';

class ColorBackground extends SegmentBuilder {
  configure = (): void => {
    this.command =
      ` -y ${this.addBlankAudio()} ` +
      ` ${this.hwaccelArg} ${this.sources.join(' ')} -t ${this.section.options.duration} ` +
      ' -r 30 ' +
      ' -shortest -pix_fmt yuv420p -c:v h264 -c:a aac -ac 2 ' +
      ` ${this.filters} -map 0:a ${this.destination} `;
  };
}

export default ColorBackground;
