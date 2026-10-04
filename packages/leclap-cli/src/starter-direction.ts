import { TemplateDescriptorSchema } from 'ffmpeg-video-composer';

export function starterMeta(withIntro: boolean, creativeDirection?: string) {
  return TemplateDescriptorSchema.parse({
    meta: {
      creativeDirection:
        creativeDirection ??
        'Introduce one brand with a restrained, centered title on a dark navy canvas. Use white condensed ' +
          'type, generous negative space and a readable final hold. Keep motion brief and purposeful; ' +
          'avoid competing headlines or decorative effects. Review the settled title and the ending.' +
          (withIntro ? ' The Remotion intro adds a mint accent and a spring entrance before the native title.' : ''),
    },
  }).meta;
}
