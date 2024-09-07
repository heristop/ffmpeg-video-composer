# FFmpeg Template Assembly

`ffmpeg-template-assembly` is a tool designed to streamline the process of video compilation using FFmpeg. It allows for dynamic template generation and video rendering, making it an ideal solution for creating personalized videos programmatically.

## Description

This project leverages FFmpeg for video processing, providing an interface to compile videos based on a template descriptor and project configuration. It simplifies the process of generating custom videos by handling complex FFmpeg commands and configurations internally.

## Getting Started

### Dependencies

Ensure you have the following prerequisites installed:

- Node.js (v18.x or higher)

### Installing

#### NPM

Install the project dependencies using npm, yarn or [pnpm](https://pnpm.io/):

```bash
pnpm add ffmpeg-template-assembly
```

#### Clone Repository

Clone the repository and install the dependencies:

```bash
git clone https://github.com/heristop/ffmpeg-template-assembly.git
cd ffmpeg-template-assembly
pnpm i
```

### Configuration

Create a JSON file (e.g., `sample.json` in the `src/shared/templates` directory) with your template descriptor.

### Usage

#### Command Line Interface

To use the `ffmpeg-template-assembly`, you can run the compile command with the path to your template JSON file as an argument:

```bash
pnpm compile src/shared/templates/sample.json
```

This will generate a video named `sample_output.mp4` in the `build` directory.

#### 🎥 See Video Sample

https://github.com/user-attachments/assets/ae226526-c21c-4d10-9ac6-e47c0db5ae8b

See the template descriptor: [sample.json](https://github.com/heristop/ffmpeg-template-assembly/blob/main/src/shared/templates/sample.json)

```bash
#### Importing the Package

Import the `compile` function from the package and provide a project configuration object:

```javascript
import { compile, loadConfig } from 'ffmpeg-template-assembly';

// Project Configuration
const projectConfig = {
  assetsDir: './assets',
  currentLocale: 'en',
  fields: {
    form_1_firstname: 'Firsname',
    form_1_lastname: 'Lastname',
  },
};
```

You might provide a template descriptor to the `compile` function to generate a video:

```javascript
compile(projectConfig, {
  global: {
    variables: {
      videoDemo: 'https://github.com/heristop/ffmpeg-template-assembly/raw/develop/src/shared/assets/videos/earth.mp4',
      colorsList: ['#FFFFFF', '#000000'],
    },
    music: {
      name: 'default',
      url: 'https://github.com/heristop/ffmpeg-template-assembly/raw/develop/src/shared/assets/musics/point_being_-_go_by_ocean___ryan_mccaffrey.mp3',
    },
    orientation: 'landscape',
    musicEnabled: true,
    transitionDuration: 0.5,
  },
  sections: [
    {
      name: 'intertitle_1',
      type: 'color_background',
      visibility: ['video_segment'],
      options: {
        backgroundColor: '{{ color2 }}@0.1',
        videoUrl: '{{ videoDemo }}',
        duration: 3,
        musicVolumeLevel: 0.4,
      },
      filters: [
        {
          type: 'drawbox',
          values: {
            x: 0,
            y: 0,
            w: 1280,
            h: 360,
            c: '{{ color1 }}@1',
            t: 'fill',
          },
        },
        {
          type: 'drawtext',
          values: {
            text: {
              en: '{{ form_1_firstname }} {{ form_1_lastname }}',
            },
            fontcolor: '{{ color1 }}',
            fontsize: 40,
            x: '(w-text_w)/2',
            y: '(h-text_h)/1.4',
            fontfile: 'Quicksand.ttf',
            alpha: "'if(lt(t,0.5),0,if(lt(t,1.5),(t-0.5)/1,if(lt(t,5),1,if(lt(t,7),(1-(t-6))/1,0))))'",
          },
        },
      ],
    },
    {
      name: 'video_1',
      type: 'video',
      visibility: ['video_segment'],
      options: {
        videoUrl: '{{ videoDemo }}',
        duration: 4,
        musicVolumeLevel: 1,
      },
      filters: [
        {
          type: 'fadein',
          values: {
            color: '{{ color2 }}',
          },
        },
        {
          type: 'fadeout',
          values: {
            color: '{{ color2 }}',
          },
        },
      ],
    },
  ],
});
```

Or you might provide a path to the template descriptor JSON file:

```javascript
await compile(projectConfig, await loadConfig('./src/shared/templates/sample.json'));
```

## Running Tests

To run tests, use the following command:

```bash
pnpm test
```

## Architecture

[![Architecture](https://github.com/heristop/ffmpeg-template-assembly/blob/main/graph.svg)](https://github.com/heristop/ffmpeg-template-assembly/blob/main/graph.svg)

## Contributing

Contributions are welcome! For major changes, please open an issue first to discuss what you would like to change. Ensure to update tests as appropriate.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
