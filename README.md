# FFmpeg Video Composer

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.x-brightgreen.svg)](https://nodejs.org/en/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`ffmpeg-video-composer` is a tool designed to streamline the process of video compilation using FFmpeg. It enables dynamic template generation and video rendering, making it a solution for creating personalized videos programmatically.

## 🎥 Demo

Check out the video sample to see `ffmpeg-video-composer` in action:

https://github.com/user-attachments/assets/ae226526-c21c-4d10-9ac6-e47c0db5ae8b

[View the template descriptor](https://github.com/heristop/ffmpeg-video-composer/blob/main/src/shared/templates/sample.json)

## 🚀 Features

- Dynamic template generation
- Easy video compilation using FFmpeg
- Supports custom project configurations
- CLI and programmatic usage options
- Flexible template descriptor system

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

## 🤝 Contributing

Contributions are welcome! If you'd like to contribute:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📬 Contact

If you have any questions or feedback, please open an issue on GitHub.