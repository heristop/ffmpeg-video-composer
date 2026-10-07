import type { Section } from '@/core/types';
import type { VideoSource } from '../editor/utils/video-input';
import { ffmpegCompat } from '../core/ffmpeg-version';

export interface FinalizeContext {
  segments: Section[];
  hasTransition: boolean;
  hasAnimations: boolean;
  musicEnabled: boolean;
  musicWillRun: boolean;
  /** The rendering FFmpeg's `-version` number, null when unknown (on-device engine, WASM core). */
  ffmpegVersion: string | null;
  normalizeWillRun: boolean;
  disableFold: boolean;
  finalPath: string;
  listPath: string;
  setFinalVideo: (path: string) => void;
  getFinalVideo: () => string;
  assemble: () => Promise<string>;
  normalizeAudio: (finalVideo: string, source?: VideoSource) => Promise<void>;
  finalize: (segments: Section[], source?: VideoSource) => Promise<void>;
}

// Fold the standalone concat-copy pass into the following audio pass when nothing between assembly
// and that pass needs a re-encode — i.e. no xfade transitions and no overlay animations — and there
// IS an audio pass to fold into (music mix or audio normalize). `disableFold` is a bench/debug escape
// hatch (FVC_DISABLE_CONCAT_FOLD) that forces the standard two-pass path. The music pass only folds
// where -shortest keeps the copied concat video whole (not on FFmpeg 9, see core/ffmpeg-version.ts).
function shouldFoldConcat(c: FinalizeContext): boolean {
  const audioPass = c.musicWillRun ? ffmpegCompat(c.ffmpegVersion).shortestKeepsConcatVideo : c.normalizeWillRun;

  return !c.disableFold && !c.hasTransition && !c.hasAnimations && audioPass;
}

// Orchestrate the post-render finalize. Folded path: the single audio pass consumes the concat
// demuxer directly (stream-copying video) and writes the final output — no standalone concat pass.
// Standard path: assemble (concat or xfade) then normalize/music as before.
export async function runFinalize(ctx: FinalizeContext): Promise<string> {
  if (shouldFoldConcat(ctx)) {
    ctx.setFinalVideo(ctx.finalPath);
    const source: VideoSource = { kind: 'concat', listPath: ctx.listPath };

    if (ctx.normalizeWillRun) {
      await ctx.normalizeAudio(ctx.finalPath, source);
      await ctx.finalize(ctx.segments);

      return ctx.finalPath;
    }

    await ctx.finalize(ctx.segments, source);

    return ctx.finalPath;
  }

  const finalPath = await ctx.assemble();

  // No-music path: the standalone audio pass in place (no-op unless global.audio.normalize or sound
  // effects ask for one). With a music mix, the mix handles both instead.
  if (!ctx.musicWillRun) {
    await ctx.normalizeAudio(ctx.getFinalVideo());
  }

  await ctx.finalize(ctx.segments);

  return finalPath;
}
