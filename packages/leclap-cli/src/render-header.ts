import path from 'node:path';
import pc from 'picocolors';
import { FFmpegDetector, FFmpegAvailability, type ProjectConfig } from 'ffmpeg-video-composer';
import { wordmark, statusRow, ok, bad, dot } from './theme.js';

// The branded header: the LeClap wordmark over an aligned status block (which ffmpeg backs the render,
// and where its assets come from). Detection is best-effort — a real failure is surfaced by compile().
export async function printHeader(projectConfig: ProjectConfig & { buildDir: string }, cwd: string): Promise<void> {
  process.stdout.write(wordmark());

  try {
    const det = await FFmpegDetector.detect();
    const engine =
      det.availability === FFmpegAvailability.NONE
        ? `${bad} ffmpeg not found  ${dot}  run ${pc.bold('leclap diagnose')}`
        : `${ok} ffmpeg ${pc.dim(det.version ?? '')}  ${dot}  ${pc.dim(det.availability)}`;
    console.log(statusRow('engine', engine));
  } catch {
    // Detection is decorative here; the real failure path is compile().
  }

  console.log(statusRow('assets', pc.dim(prettyAssets(projectConfig.assetsDir, cwd))));
  console.log('');
}

function prettyAssets(dir: string | undefined, cwd: string): string {
  if (!dir) return 'none';
  const rel = path.relative(cwd, dir);

  return rel === '' ? '.' : rel;
}
