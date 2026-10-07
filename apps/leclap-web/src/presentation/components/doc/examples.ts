// Two complete, valid descriptors lifted from docs/template-configuration.md. They
// validate against TemplateDescriptorSchema; keep them in sync with that doc.

export interface DescriptorExample {
  id: string;
  title: string;
  blurb: string;
  json: string;
}

const simple = {
  global: {
    orientation: 'landscape',
    musicEnabled: true,
    music: { name: 'lofi-jazz-music.mp3' },
    audio: { sourceVolume: 1, musicVolume: 0.5 },
  },
  sections: [
    {
      name: 'intro',
      type: 'color_background',
      transition: { type: 'cut' },
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
    },
    {
      name: 'clip',
      type: 'video',
      options: { videoUrl: '{{ clip }}', duration: 6 },
      filters: [
        { type: 'fadein', values: { color: '#0d1b2a' } },
        { type: 'fadeout', values: { color: '#0d1b2a' } },
      ],
    },
  ],
};

const rich = {
  global: {
    orientation: 'landscape',
    musicEnabled: true,
    music: { name: 'lofi-jazz-music.mp3' },
    transition: { type: 'fade', duration: 0.4 },
    audio: {
      sourceVolume: 1,
      musicVolume: 0.5,
      normalize: 'loudnorm',
      ducking: { threshold: 0.05, ratio: 8 },
    },
  },
  sections: [
    {
      name: 'title',
      type: 'color_background',
      title: { en: 'Title card' },
      transition: { type: 'wipeleft', duration: 0.4 },
      options: {
        backgroundColor: '#0d1b2a',
        duration: 2.4,
        audioFade: { in: { duration: 0.6, curve: 'qsin' } },
        layers: [
          { color: '#13243f', opacity: 1, x: 0, y: 0, w: 1280, h: 150 },
          {
            x: 0,
            y: 570,
            w: 1280,
            h: 150,
            gradient: { from: '#13243f', to: '#0d1b2a', direction: 'vertical' },
          },
        ],
      },
      filters: [
        {
          type: 'drawtext',
          values: {
            text: { en: 'PRESENTING' },
            fontcolor: '#e8eef7',
            fontsize: 30,
            x: '(w-text_w)/2',
            y: 250,
            fontfile: 'Oswald.ttf',
          },
        },
      ],
    },
    {
      name: 'still',
      type: 'image_background',
      transition: { type: 'fade', duration: 0.4 },
      options: { pictureUrl: '{{ photo }}', duration: 3 },
      look: 'cinematic',
      grade: { contrast: 1.1, saturation: 1.2 },
      motion: [{ type: 'kenburns', direction: 'in', intensity: 1.2 }],
    },
    {
      name: 'clip',
      type: 'project_video',
      title: { en: 'Record your clip' },
      options: {
        duration: 30,
        forceAspectRatio: true,
        framingGuide: { type: 'silhouette', position: 'center', opacity: 0.5 },
      },
      look: 'warm',
      grade: {
        brightness: 0.02,
        saturation: 1.15,
        colorBalance: { highlights: { r: 0.05, b: -0.05 } },
      },
      filters: [{ type: 'vignette' }],
    },
  ],
};

export const examples: DescriptorExample[] = [
  {
    id: 'example-simple',
    title: 'Cuts + music',
    blurb: 'A minimal, complete descriptor — two clips joined by hard cuts over a background track.',
    json: JSON.stringify(simple, null, 2),
  },
  {
    id: 'example-rich',
    title: 'Transition · look · motion · audio · layers',
    blurb:
      'The structured-sugar layer in full: a layered title card wipes into a Ken-Burns still, then a graded clip with ducked, normalised audio.',
    json: JSON.stringify(rich, null, 2),
  },
];
