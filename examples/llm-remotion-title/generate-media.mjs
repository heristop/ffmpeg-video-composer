import { mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const font = process.argv[2];

if (!font) throw new Error('Pass a local .ttf font file: node generate-media.mjs /absolute/path/font.ttf');
await mkdir(path.join(directory, 'media'), { recursive: true });
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

  if (result.error) throw result.error;

  if (result.status !== 0) throw new Error(`Fixture FFmpeg exited ${result.status}`);
}
ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'color=c=0x101022:s=1280x720:r=30:d=10',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-pix_fmt',
  'yuv420p',
  path.join(directory, 'media/background.mp4'),
]);
ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'color=c=0x7c83ff:s=256x256',
  '-frames:v',
  '1',
  '-threads',
  '1',
  path.join(directory, 'media/logo.png'),
]);
await copyFile(path.resolve(font), path.join(directory, 'media/font.ttf'));
// Deterministic product-studio illustration; replace with an actual local screenshot for fidelity.
ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'color=c=0x171729:s=1280x720',
  '-vf',
  [
    'drawbox=x=0:y=0:w=220:h=720:color=0x24243c:t=fill',
    'drawbox=x=30:y=40:w=150:h=22:color=0xb9a2ff:t=fill',
    'drawbox=x=30:y=115:w=130:h=12:color=0x666681:t=fill',
    'drawbox=x=30:y=160:w=110:h=12:color=0x666681:t=fill',
    'drawbox=x=270:y=45:w=450:h=28:color=0xe9e5ff:t=fill',
    'drawbox=x=270:y=105:w=930:h=2:color=0x45455d:t=fill',
    'drawbox=x=280:y=150:w=420:h=290:color=0x7c83fd:t=fill',
    'drawbox=x=730:y=150:w=220:h=290:color=0xff8aae:t=fill',
    'drawbox=x=980:y=150:w=220:h=290:color=0xfff685:t=fill',
    'drawbox=x=280:y=475:w=920:h=150:color=0x33334f:t=fill',
    'drawbox=x=300:y=495:w=570:h=18:color=0xb9a2ff:t=fill',
    'drawbox=x=300:y=535:w=340:h=12:color=0x666681:t=fill',
    'drawbox=x=1060:y=550:w=110:h=45:color=0xb9a2ff:t=fill',
  ].join(','),
  '-frames:v',
  '1',
  '-threads',
  '1',
  path.join(directory, 'media/screenshot.png'),
]);
