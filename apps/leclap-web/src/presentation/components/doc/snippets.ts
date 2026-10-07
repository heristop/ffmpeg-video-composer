// Focused config samples shown on the reference pages — each illustrates one feature in context.
// Kept minimal and realistic; the full, end-to-end descriptors live in `examples.ts`.

const json = (value: unknown): string => JSON.stringify(value, null, 2);

export const snippets = {
  section: json({
    name: 'intro',
    type: 'color_background',
    options: { backgroundColor: '#0d1b2a', duration: 3 },
  }),

  animation: json({
    name: 'intro',
    type: 'image_background',
    options: { pictureUrl: '{{ photo }}', duration: 4 },
    inputs: [
      {
        name: 'border',
        url: '/assets/animations/rounded_border.apng',
        type: 'animation',
        options: { position: '0:0', scale: '1280:720', loop: false, persistent: true },
      },
    ],
  }),

  transition: json({
    global: { transition: { type: 'fade', duration: 0.4 } },
    sections: [
      { name: 'a', type: 'color_background', options: { backgroundColor: '#0d1b2a', duration: 2 } },
      {
        name: 'b',
        type: 'video',
        transition: { type: 'wipeleft', duration: 0.5 },
        options: { videoUrl: '{{ clip }}', duration: 4 },
      },
    ],
  }),

  look: json({
    name: 'still',
    type: 'image_background',
    options: { pictureUrl: '{{ photo }}', duration: 3 },
    look: 'cinematic',
  }),

  grade: json({
    name: 'still',
    type: 'image_background',
    options: { pictureUrl: '{{ photo }}', duration: 3 },
    look: 'cinematic',
    grade: {
      contrast: 1.1,
      saturation: 1.2,
      colorBalance: { highlights: { r: 0.05, b: -0.05 } },
    },
  }),

  motion: json({
    name: 'clip',
    type: 'video',
    options: { videoUrl: '{{ clip }}', duration: 6 },
    motion: [
      { type: 'kenburns', direction: 'in', intensity: 1.2 },
      { type: 'flip', axis: 'horizontal' },
    ],
  }),

  speed: json({
    name: 'slowmo',
    type: 'video',
    // speed is a PTS multiplier: 2 = half-speed (slow-mo), 0.5 = 2x (fast). It only takes effect
    // with a setpts map node; muteSection avoids an atempo pitch shift on the (now silent) audio.
    options: { videoUrl: '{{ clip }}', duration: 4, speed: 2, muteSection: true },
    maps: [{ inputs: ['1:v'], filters: [{ type: 'setpts', value: '2*PTS' }], outputs: ['final'] }],
  }),

  framingGuide: json({
    name: 'record',
    type: 'project_video',
    options: {
      duration: 30,
      forceAspectRatio: true,
      framingGuide: { type: 'silhouette', position: 'center', opacity: 0.5, style: 'bust' },
    },
  }),

  captureMode: json({
    name: 'record',
    type: 'project_video',
    options: {
      duration: 30,
      captureMode: 'front',
      allowedCaptureModes: ['front', 'back', 'upload'],
    },
  }),

  layers: json({
    name: 'card',
    type: 'color_background',
    options: {
      backgroundColor: '#0d1b2a',
      duration: 3,
      layers: [
        { color: '#13243f', opacity: 1, x: 0, y: 0, w: 1280, h: 150 },
        { x: 0, y: 570, w: 1280, h: 150, gradient: { from: '#13243f', to: '#0d1b2a', direction: 'vertical' } },
      ],
    },
  }),

  audio: json({
    global: {
      musicEnabled: true,
      music: { name: 'lofi-jazz-music.mp3' },
      audio: {
        sourceVolume: 1,
        musicVolume: 0.5,
        normalize: 'loudnorm',
        ducking: { threshold: 0.05, ratio: 8 },
      },
    },
  }),

  audioFade: json({
    name: 'title',
    type: 'color_background',
    options: {
      backgroundColor: '#0d1b2a',
      duration: 2.4,
      audioFade: { in: { duration: 0.6, curve: 'qsin' }, out: { duration: 0.4, curve: 'tri' } },
    },
  }),

  caption: json({
    name: 'scene',
    type: 'video',
    options: { videoUrl: '{{ clip }}', duration: 5 },
    caption: { text: { en: 'Chapter One' }, style: 'bar', position: 'lower-third', align: 'left' },
  }),

  filters: json({
    name: 'intro',
    type: 'color_background',
    options: { backgroundColor: '#0d1b2a', duration: 2 },
    filters: [
      {
        type: 'drawtext',
        values: {
          text: { en: 'My Story' },
          fontcolor: '#ffffff',
          fontsize: 96,
          x: '(w-text_w)/2',
          y: '(h-text_h)/2',
          fontfile: 'BebasNeue.ttf',
        },
      },
    ],
  }),

  maps: json({
    name: 'composite',
    type: 'video',
    options: { videoUrl: '{{ clip }}', duration: 6 },
    maps: [{ inputs: ['0:v'], outputs: ['bg'], filters: [{ type: 'scale', value: '1280:720' }] }],
  }),
} as const;
