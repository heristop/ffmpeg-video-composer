import ImageBackground from '../segments/ImageBackgroundSegment';
import ProjectVideo from '../segments/ProjectVideoSegment';
import Video from '../segments/VideoSegment';
import ColorBackground from '../segments/ColorBackgroundSegment';
import { Section } from '@/core/types';

class SegmentFactory {
  create(section: Section) {
    const classesMapping = {
      video: Video,
      project_video: ProjectVideo,
      image_background: ImageBackground,
      color_background: ColorBackground,
    };

    const SegmentClass = classesMapping[section.type];

    if (!SegmentClass) {
      throw new Error(`Unsupported segment type: ${section.type}`);
    }

    return new SegmentClass().hydrate(section);
  }
}

export default SegmentFactory;
