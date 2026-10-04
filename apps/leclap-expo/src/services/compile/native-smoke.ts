import { compileOnDevice } from './compileOnDevice';
import * as Leclap from '@/modules/leclap-ffmpeg';

/** Small offline composition covering the production JSON pipeline, including text, motion and music. */
export const NATIVE_SMOKE_TEMPLATE = {
  meta: { name: 'Native engine check' },
  global: {
    orientation: 'landscape',
    fps: 30,
    musicEnabled: true,
    music: { name: 'point-being.mp3' },
    audio: { musicVolume: 0.15, sourceVolume: 0.8 },
  },
  sections: [
    {
      name: 'title',
      type: 'color_background',
      options: { backgroundColor: '#111827', duration: 1 },
      titleCard: {
        headline: { en: 'ON DEVICE' },
        subtitle: { en: 'JSON to native FFmpeg' },
        headlineStyle: { font: 'rubik' },
        subtitleStyle: { font: 'rubik' },
        reveal: { type: 'rise', duration: 0.3, easing: 'ease-out' },
      },
    },
    {
      name: 'footage',
      type: 'project_video',
      options: { duration: 2 },
      caption: {
        text: { en: 'LECLAP' },
        font: 'rubik',
        fontsize: 48,
        color: '#ffffff',
        position: 'bottom',
        reveal: { type: 'rise', duration: 0.3 },
      },
      motion: [{ type: 'pulse', intensity: 1.04, frequency: 1 }],
    },
  ],
};

interface ProbeOutput {
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }>;
  format?: { duration?: string };
}

function isExpectedVideo(video: NonNullable<ProbeOutput['streams']>[number] | undefined): boolean {
  return video?.codec_name === 'h264' && video.width === 1280 && video.height === 720 && video.r_frame_rate === '30/1';
}

function assertOutput(output: ProbeOutput): void {
  const video = output.streams?.find((stream) => stream.codec_type === 'video');
  const audio = output.streams?.find((stream) => stream.codec_type === 'audio');
  const duration = Number(output.format?.duration);
  const validDuration = Number.isFinite(duration) && duration >= 2.9 && duration <= 3.2;

  if (!isExpectedVideo(video) || audio?.codec_name !== 'aac' || !validDuration) {
    throw new Error('Unexpected native output: expected 3s H.264/AAC, 1280×720 at 30 fps');
  }
}

async function compilePass(inputUri: string, append: (line: string) => void, pass: number): Promise<string> {
  append(`JSON composition ${pass}/2…`);
  const result = await compileOnDevice(
    JSON.parse(JSON.stringify(NATIVE_SMOKE_TEMPLATE)),
    { footage: { path: inputUri, orientation: 'landscape' } },
    { qualityTier: 'draft' }
  );

  if (!result.success || !result.outputUri) throw new Error(result.error ?? 'Native compilation produced no output');
  const probe = await Leclap.probe([
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    result.outputUri.replace(/^file:\/\//, ''),
  ]);

  if (probe.code !== 0) throw new Error(probe.output || 'Native output probe failed');
  const output = JSON.parse(probe.output) as ProbeOutput;
  assertOutput(output);
  const message = `Pass ${pass}: H.264/AAC, 1280×720, 30 fps, ${Number(output.format?.duration).toFixed(3)}s`;
  append(message);
  console.info('[native-smoke]', message);

  return result.outputUri;
}

/** Two serial compositions exercise process-global FFmpeg state; parallel passes would test another property. */
export async function runNativeSmoke(inputUri: string, append: (line: string) => void): Promise<string> {
  await compilePass(inputUri, append, 1);

  return compilePass(inputUri, append, 2);
}
