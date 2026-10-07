import type { IEventEmitter } from '../platform/AbstractEventManager';
import { inject, injectable } from 'tsyringe';
import type AbstractLogger from '../platform/logging/AbstractLogger';
import type AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import type AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import type Template from '../core/models/Template';
import type Project from '../core/models/Project';
import type { Section } from '@/core/types';
import DefaultConfig from '@/core/default.config';
import type MusicComposer from './MusicComposer';
import type AnimationComposer from './AnimationComposer';
import type { StagedAnimation } from './AnimationComposer';
import { getPerfTimer } from '../utils/perf-timer';
import type { VideoSource } from './utils/video-input';
import { buildColorMetadataArgs, buildPixFmtArg, buildVideoEncoderArgs } from '@/core/encoding';
import { hasWholeVideoOverlays } from './presets/watermark';
import {
  buildAudioGraph,
  buildNormalizeGraph,
  buildVideoGraph,
  computeOffsets,
  effectiveDurations as computeEffectiveDurations,
  round,
  type SegmentProbe,
  type Transition,
} from './utils/transition-graph';
import { isDesignedTransition } from '@/core/motion/transitions';

@injectable()
class VideoEditor {
  public emitter: IEventEmitter | undefined;

  constructor(
    @inject('project') private readonly project: Project,
    @inject('template') private readonly template: Template,
    @inject('MusicComposer') private readonly musicComposer: MusicComposer,
    @inject('AnimationComposer') private readonly animationComposer: AnimationComposer,

    @inject('logger') private readonly logger: AbstractLogger,
    @inject('ffmpegAdapter') private readonly ffmpegAdapter: AbstractFFmpeg,
    @inject('filesystemAdapter')
    private readonly filesystemAdapter: AbstractFilesystem
  ) {}

  private buildConcatCommand(concatFilePath: string, finalOutputPath: string): string {
    return (
      ' -y -f concat -safe 0 -auto_convert 1 ' +
      ` -i ${concatFilePath} ` +
      ` -c copy -movflags +faststart ${finalOutputPath} `
    );
  }

  private async copySingleFile(sourceRaw: string, finalOutputPath: string): Promise<string> {
    const sourceFile = sourceRaw.replace(/^file\s+'?|'?$/g, '').trim();

    // Remux (stream-copy, no re-encode) rather than a raw byte copy so the moov atom moves to the
    // front: segment encoders leave it at the end, which keeps single-section outputs from playing
    // in a browser <video> until fully buffered (black preview). The multi-section concat path
    // already applies +faststart; this gives single-section templates the same treatment.
    const remuxed = await this.tryFaststartRemux(sourceFile, finalOutputPath);

    if (remuxed) {
      this.logger.info(`[Concat][Command] Remuxed single file (+faststart) to ${finalOutputPath}`);

      return finalOutputPath;
    }

    // Remux unavailable/failed (e.g. an unexpected container) — fall back to a byte copy so the
    // render still produces a playable file rather than erroring out.
    await this.filesystemAdapter.copy(sourceFile, finalOutputPath);
    this.logger.info(`[Concat][Command] Copied single file to ${finalOutputPath}`);

    return finalOutputPath;
  }

  // Returns true on a successful faststart remux, false on any failure. Adapters differ: the Node
  // adapter throws on a non-zero exit, the WASM/native adapters return `{ rc: 1 }` — handle both.
  private async tryFaststartRemux(sourceFile: string, finalOutputPath: string): Promise<boolean> {
    try {
      const result = await this.ffmpegAdapter.execute(
        ` -y -i ${sourceFile} -c copy -movflags +faststart ${finalOutputPath} `
      );

      return result.rc !== 1;
    } catch {
      return false;
    }
  }

  private async runConcatCommand(concatFilePath: string, finalOutputPath: string): Promise<string> {
    const command = this.buildConcatCommand(concatFilePath, finalOutputPath);
    this.logger.debug(`[Concat][Command] ffmpeg ${command}`);

    const result = await this.ffmpegAdapter.execute(command);
    this.logger.info(`[Concat] ffmpeg process exited with rc ${result.rc}`);

    if (result.rc === 1) {
      this.project.errors.push('concat');

      throw new Error('[Concat] Errors on concatenation');
    }

    return finalOutputPath;
  }

  concat = async (): Promise<string> => {
    try {
      const buildDir = this.filesystemAdapter.getBuildDir() ?? 'build';
      const finalOutputPath = this.project.output.staging || `${buildDir}/output.mp4`;
      this.project.finalVideo = finalOutputPath;

      const concatFilePath = this.project.buildInfos.fileConcatPath;

      if (!concatFilePath) {
        throw new Error('Concat file path is not defined');
      }

      const fileList = await this.filesystemAdapter.read(concatFilePath);
      const files = fileList.split('\n').filter(Boolean);

      if (files.length === 0) {
        throw new Error('No files to concat in the segments list');
      }

      if (files.length === 1) {
        return await this.copySingleFile(files[0], finalOutputPath);
      }

      return await this.runConcatCommand(concatFilePath, finalOutputPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[Concat] Error: ${message}`);

      throw error;
    }
  };

  /**
   * Assembles the final video in a single re-encode pass using xfade (video) + acrossfade (audio)
   * when one or more boundaries carry a non-cut transition. Unlike concat() this never stream-copies:
   * the whole timeline is re-encoded so the cross-dissolves can be rendered. Designed to be called by
   * TemplateDirector with the per-boundary transition list (`transitions.length === segmentFiles.length - 1`).
   *
   * Durations are PROBED (never declared): speed/setpts sections, `-shortest` and fps rounding make the
   * authored durations lie, and an off-by-a-frame offset desyncs every later boundary.
   *
   * No fallback to concat — by design. Any adapter failure propagates as a compilation error.
   */
  assembleWithTransitions = async (segmentFiles: string[], transitions: Transition[]): Promise<string> => {
    try {
      if (segmentFiles.length < 2) {
        throw new Error(`[Transitions] assembleWithTransitions needs at least 2 segments, got ${segmentFiles.length}`);
      }

      if (transitions.length !== segmentFiles.length - 1) {
        throw new Error(
          `[Transitions] expected ${segmentFiles.length - 1} transitions for ${segmentFiles.length} segments, got ${transitions.length}`
        );
      }

      const buildDir = this.filesystemAdapter.getBuildDir() ?? 'build';
      const finalOutputPath = this.project.output.staging || `${buildDir}/output.mp4`;
      this.project.finalVideo = finalOutputPath;

      const probes = await this.probeSegments(segmentFiles);
      const command = this.buildTransitionsCommand(
        segmentFiles,
        transitions,
        probes,
        finalOutputPath,
        await this.stageOverlaysForFusion()
      );

      this.logger.debug(`[Transitions][Command] ffmpeg ${command}`);
      const result = await this.ffmpegAdapter.execute(command);
      this.logger.info(`[Transitions] ffmpeg process exited with rc ${result.rc}`);

      if (result.rc === 1) {
        this.project.errors.push('transitions');

        throw new Error('[Transitions] Errors on transition assembly');
      }

      return finalOutputPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[Transitions] Error: ${message}`);

      throw error;
    }
  };

  // Stage whole-video animations so xfade + overlay fuse into one re-encode (the separate overlay pass
  // in finalize then skips). Empty when none declared, or when FVC_DISABLE_FUSION forces the two-pass
  // path (bench/debug A/B — overlayAnimations re-runs in that case).
  private async stageOverlaysForFusion(): Promise<StagedAnimation[]> {
    if (!hasWholeVideoOverlays(this.template.descriptor.global) || process.env.FVC_DISABLE_FUSION) {
      return [];
    }

    return this.animationComposer.loadAnimations();
  }

  private async probeSegments(segmentFiles: string[]): Promise<SegmentProbe[]> {
    const infos = await Promise.all(
      segmentFiles.map(async (file) => {
        try {
          return await this.ffmpegAdapter.getInfos(file);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';

          throw new Error(`[Transitions] could not probe segment ${file}: ${message}`);
        }
      })
    );

    return infos.map((info, k) => {
      if (!info.duration) {
        throw new Error(`[Transitions] could not probe duration of segment ${segmentFiles[k]}`);
      }

      return { duration: info.duration, hasAudio: info.audioCodec !== null };
    });
  }

  /**
   * Builds the full ffmpeg command: one `-i` per segment, optional extra `-f lavfi -i aevalsrc=…`
   * inputs that synthesize a silent audio leg for video-only segments (so acrossfade always has two
   * audio inputs), then the xfade/acrossfade filtergraph and the re-encode output args.
   */
  private buildTransitionsCommand(
    segmentFiles: string[],
    transitions: Transition[],
    probes: SegmentProbe[],
    finalOutputPath: string,
    staged: StagedAnimation[] = []
  ): string {
    const sampleRate = this.project.config.audioConfig?.sampleRate ?? 48000;
    const inputs = segmentFiles.map((file) => ` -i ${file} `).join('');

    // Each silent segment gets one extra lavfi input appended after the n segment inputs. Track which
    // input index carries the audio leg for every segment (its own `[k:a]`, or the synthesized source).
    const silentInputs: string[] = [];
    const audioInputIndex = probes.map((probe, k) => {
      if (probe.hasAudio) {
        return k;
      }

      const index = segmentFiles.length + silentInputs.length;
      silentInputs.push(` -f lavfi -i aevalsrc=0:d=${probe.duration}:s=${sampleRate} `);

      return index;
    });

    const effectiveDurations = computeEffectiveDurations(transitions, probes);
    const offsets = computeOffsets(probes, effectiveDurations);
    const scale = this.project.config.videoConfig?.scale ?? DefaultConfig.SCALE;
    const fps = this.project.config.videoConfig?.fps ?? DefaultConfig.FPS;
    const normalizeGraph = buildNormalizeGraph(
      segmentFiles.length,
      scale,
      transitions.some((transition) => isDesignedTransition(transition.type))
    );
    const audioGraph = buildAudioGraph(transitions, audioInputIndex, effectiveDurations);

    // Fused path: when the template has whole-video animation overlays, weave the overlay graph onto
    // the xfade output (`[vfx]`) so transitions + overlays re-encode in ONE pass instead of two
    // (buildFusedOverlay offsets the animation inputs past the segments + uses a distinct `ov` chain).
    const fuse = staged.length > 0;
    const assembledDuration = round(this.sum(probes.map((p) => p.duration)) - this.sum(effectiveDurations));
    const overlay = fuse
      ? this.animationComposer.buildFusedOverlay(staged, {
          inputOffset: segmentFiles.length + silentInputs.length,
          maxDuration: assembledDuration,
        })
      : { sources: '', graph: '' };

    const videoGraph = buildVideoGraph(transitions, offsets, effectiveDurations, fuse ? '[vfx]' : '[vout]', {
      scale,
      fps,
    });
    const filterComplex = [normalizeGraph, videoGraph, overlay.graph, audioGraph].filter(Boolean).join(';');
    const outputArgs = `${buildVideoEncoderArgs(this.project.config)} ${buildPixFmtArg(this.project.config)} ${buildColorMetadataArgs(this.project.config, this.project.ffmpegVersion)}`;

    return (
      ' -y ' +
      inputs +
      silentInputs.join('') +
      (overlay.sources ? ` ${overlay.sources} ` : '') +
      ` -filter_complex "${filterComplex}" ` +
      ` -map "[vout]" -map "[aout]" -r ${fps} ${outputArgs} -c:a aac -ac 2 -movflags +faststart ${finalOutputPath} `
    );
  }

  private sum(values: number[]): number {
    return values.reduce((total, v) => total + v, 0);
  }

  private async cleanupConcatFile(): Promise<void> {
    const concatFilePath = this.project.buildInfos.fileConcatPath;

    if (concatFilePath) {
      try {
        await this.filesystemAdapter.unlink(concatFilePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Could not delete segments file: ${message}`);
      }
    }
  }

  // Whole-video animation overlays (global.animations) are composited over the joined video first,
  // re-encoding it once; music (below) then stream-copies that overlaid video. Runs only when the
  // template declares overlays and a final video exists.
  private async overlayAnimations(): Promise<void> {
    // When the timeline has transitions, assembleWithTransitions already fused the overlays into the
    // xfade re-encode — running a second overlay pass here would double-apply them. Only overlay
    // standalone when there are no transitions (the plain-concat assembly path), or when fusion was
    // forced off (FVC_DISABLE_FUSION) so assembly skipped it and this pass must run.
    const hasTransition = this.project.buildInfos.transitions.some((t) => t.type !== 'cut');

    if (hasTransition && !process.env.FVC_DISABLE_FUSION) {
      return;
    }

    if (hasWholeVideoOverlays(this.template.descriptor.global) && this.project.finalVideo) {
      await this.animationComposer.appendAnimations(this.project.finalVideo);
    }
  }

  // Music is mixed only when the template enables it AND a track actually resolved (buildInfos.
  // musicPath is empty when none is selected). Without a track there's nothing to loop or append —
  // the concat output is already the final video. Probing an empty path would otherwise fail.
  private async mixMusic(segments: Section[], videoSource?: VideoSource): Promise<void> {
    if (
      !this.template.descriptor.global?.musicEnabled ||
      !this.project.buildInfos.musicPath ||
      !this.project.finalVideo
    ) {
      return;
    }

    await this.musicComposer.loopMusic();
    await this.musicComposer.appendMusic(segments, this.project.finalVideo, videoSource);
  }

  private async emitFinalize(): Promise<void> {
    if (this.project.errors.length > 0) {
      return;
    }

    this.emitter?.emit('finalize', {
      video_source: this.project.finalVideo,
      template_assets: this.template.assets,
    });

    await this.cleanupConcatFile();

    this.emitter?.emit('compilation-progress', 1);
    this.logger.info('[End] project cleaned');

    this.project.clean();
    this.template.clean();
  }

  finalize = async (segments: Section[], videoSource?: VideoSource): Promise<void> => {
    const timer = getPerfTimer();

    try {
      await timer.span('final:animations', () => this.overlayAnimations());
      await timer.span('final:music', () => this.mixMusic(segments, videoSource));
      await this.emitFinalize();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[Finalize] Error: ${message}`);
      // Record then rethrow: in the folded path the music/normalize pass is what WRITES the final
      // file, so swallowing here made compile() resolve a path to an output that never existed.
      // The non-empty errors list also keeps emitFinalize/clean() skipped, and resetBuildState
      // clears it at the start of the next compile.
      this.project.errors.push('finalize');

      throw error;
    }
  };
}

export default VideoEditor;
