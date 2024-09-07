# FFmpeg Video Composer

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.x-brightgreen.svg)](https://nodejs.org/en/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`ffmpeg-video-composer` is a tool designed to streamline the process of video compilation and audio mixing using FFmpeg. It enables dynamic template generation, video rendering, and audio composition, making it a comprehensive solution for creating personalized multimedia content programmatically.

## 🎥 Demo

Check out the video sample to see `ffmpeg-video-composer` in action (unmute for sound):

https://github.com/user-attachments/assets/266f07b5-a5da-4512-80fa-3b6f47b2001c

[View the template descriptor](https://github.com/heristop/ffmpeg-video-composer/blob/main/src/shared/templates/sample.json)

## 🚀 Features

* Dynamic video and audio template generation
* Easy video compilation and audio mixing using FFmpeg
* Flexible JSON-based template descriptor system
* CLI for quick video creation
* JSON configuration for complex project setups
* Custom project configurations support
* Audio overlay and mixing capabilities
* Automated video editing and composition

## 🛠 Installation

### Using npm (or yarn/pnpm)

```bash
pnpm add ffmpeg-video-composer
```

### Cloning the Repository

```bash
git clone https://github.com/heristop/ffmpeg-video-composer.git
cd ffmpeg-video-composer
pnpm i
```

## 📖 Usage

### Command Line Interface

```bash
pnpm compile src/shared/templates/sample.json
```

This generates `sample_output.mp4` in the `build` directory.

### Programmatic Usage

```javascript
import { compile, loadConfig } from 'ffmpeg-video-composer';

const projectConfig = {
  assetsDir: './assets',
  currentLocale: 'en',
  fields: {
    form_1_firstname: 'Firstname',
    form_1_lastname: 'Lastname',
  },
};

// Using a template descriptor object
compile(projectConfig, {
  global: {
    // ... (template configuration)
  },
  sections: [
    // ... (section configurations)
  ],
});

// Or using a JSON file
await compile(projectConfig, await loadConfig('./src/shared/templates/sample.json'));
```

## 🏗 Architecture

The project architecture ensures efficient video processing and template management:

[![Architecture](https://github.com/heristop/ffmpeg-video-composer/blob/main/graph.svg)](https://github.com/heristop/ffmpeg-video-composer/blob/main/graph.svg)

## 🧪 Running Tests

Ensure the quality of the codebase by running the test suite:

```bash
pnpm test
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📬 Contact

If you have any questions or feedback, please open an issue on GitHub.
