import { inject, injectable, registry, type DependencyContainer } from 'tsyringe';

import type AbstractLogger from '../platform/logging/AbstractLogger';
import type AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import type AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import type AbstractEventManager from '../platform/AbstractEventManager';
import type { IEventEmitter } from '../platform/AbstractEventManager';
import type VideoEditor from '../editor/VideoEditor';
import type MusicComposer from '../editor/MusicComposer';
import type { FFMpegInfos, ProjectConfig, Section, TemplateDescriptor } from '@/core/types';
import { DEFAULT_TRANSITION_DURATION } from '../schemas/effects.schemas';
import { fetchSectionInfos, segmentOutputPath } from './section-infos';
import { getPerfTimer } from '../utils/perf-timer';
import { renderSegments } from './render-segments-concurrently';
import { runFinalize } from './finalize-concat-fold';
import { resolveOrientationScale, resolveFps } from './resolve-video-config';
import { assertCanProbe, renderNeeds } from './render-needs';
import { VIDEO_SEGMENT_TYPES } from '../editor/utils/section-types';
import { expandPartialsSafe, assertEffectsResolved } from '@/core/partials';
import type Project from '../core/models/Project';
import type Template from '../core/models/Template';
import type TemplateConcreteBuilder from './TemplateConcreteBuilder';

type DirectorDeps = {
  concreteBuilder: TemplateConcreteBuilder;
  musicComposer: MusicComposer;
  project: Project;
  template: Template;
  logger: AbstractLogger;
  ffmpegAdapter: AbstractFFmpeg;
  filesystemAdapter: AbstractFilesystem;
};

@registry([
  {
    token: 'DirectorDeps',
    useFactory: (c: DependencyContainer): DirectorDeps => ({
      concreteBuilder: c.resolve<TemplateConcreteBuilder>('TemplateConcreteBuilder'),
      musicComposer: c.resolve<MusicComposer>('MusicComposer'),
      project: c.resolve<Project>('project'),
      template: c.resolve<Template>('template'),
      logger: c.resolve<AbstractLogger>('logger'),
      ffmpegAdapter: c.resolve<AbstractFFmpeg>('ffmpegAdapter'),
      filesystemAdapter: c.resolve<AbstractFilesystem>('filesystemAdapter'),
    }),
  },
])
@injectable()
class TemplateDirector {
  private readonly emitter: IEventEmitter;

  private stopBuild = false;
  private readonly onTaskCancelled = () => (this.stopBuild = true);
  private readonly concreteBuilder: TemplateConcreteBuilder;
  private readonly musicComposer: MusicComposer;
  private readonly project: Project;
  private readonly template: Template;
  private readonly logger: AbstractLogger;
  private readonly ffmpegAdapter: AbstractFFmpeg;
  private readonly filesystemAdapter: AbstractFilesystem;

  constructor(
    @inject('eventManager') private readonly eventManager: AbstractEventManager,
    @inject('VideoEditor') private readonly videoEditor: VideoEditor,
    @inject('DirectorDeps') deps: DirectorDeps
  ) {
    this.concreteBuilder = deps.concreteBuilder;
    this.musicComposer = deps.musicComposer;
    this.project = deps.project;
    this.template = deps.template;
    this.logger = deps.logger;
    this.ffmpegAdapter = deps.ffmpegAdapter;
    this.filesystemAdapter = deps.filesystemAdapter;
    this.emitter = this.eventManager.connect();
    this.emitter.on('task-cancelled', this.onTaskCancelled);
    this.videoEditor.emitter = this.emitter;
    this.logger.info('Director class created');
  }

  // The emitter this director publishes `compilation-progress` / `task-stopped` on. Exposed so the Node
  // `compile()` can subscribe to the SAME emitter — the Node EventManager hands out a fresh emitter on
  // every `connect()`, so a caller cannot reconnect to reach this one.
  get events(): IEventEmitter {
    return this.emitter;
  }

  config = (projectConfig: ProjectConfig, templateDescriptor: TemplateDescriptor): this => {
    // Deep-clone the descriptor: section.filters are mutated in place during builds (sugar/scale prepend
    // preset filters), so compiling the same descriptor twice would double-apply them (Ken Burns twice,
    // contrast squared). JSON round-trip matches the repo's deep-clone (Hermes/WASM-safe plain JSON).
    const clonedDescriptor = structuredClone(templateDescriptor);
    // Expand `{ type:'partial', ref }` sections into real sections here, the single point where the
    // descriptor used for compilation is set. Callers pass the raw descriptor (Node `compile` never
    // validates; the browser path validates into the template but this assignment would overwrite it),
    // so without this every partial — logo bumper, flash-card — is dropped downstream by the
    // rendering-type filter. Idempotent: re-expanding an already-expanded descriptor is a no-op.
    const expansion = expandPartialsSafe(clonedDescriptor);

    if (!expansion.ok) {
      // Unknown ref: keep the clone (the stray partial is skipped by compileVideoSegments, as before).
      this.logger.warn(`[Director] partial expansion failed: ${expansion.error.message}`);
    }

    this.template.descriptor = assertEffectsResolved(expansion.ok ? expansion.data : clonedDescriptor);
    this.project.config = projectConfig;

    // Reset ALL build-accumulated state at the start of every compile() (config() runs first), so
    // back-to-back compiles in one long-lived process (browser / on-device) are independent — see
    // Project.resetBuildState for why (the videoInputs cascade).
    this.project.resetBuildState();

    this.filesystemAdapter.setBuildDir(this.project.config.buildDir ?? 'build');
    this.filesystemAdapter.setAssetsDir(this.project.config.assetsDir ?? 'assets');

    this.project.applyDefault();
    this.applyOrientationToScale();
    this.applyFpsToConfig();

    const paths = this.project.config.userVideoPaths;
    this.logger.info(
      paths
        ? `TemplateDirector received userVideoPaths for sections: ${Object.keys(paths).join(', ')}`
        : 'TemplateDirector: No userVideoPaths provided in config'
    );

    return this;
  };

  // Resolve orientation + fps ONCE, here — the single point where the descriptor and the project
  // config meet. Pure resolution lives in resolve-video-config (line-budget + testability); replaces
  // the old per-SegmentBuilder orientation swap, which mutated the shared config per segment and
  // alternated orientation across them.
  private readonly applyOrientationToScale = (): void => {
    this.project.config.videoConfig = resolveOrientationScale(
      this.project.config.videoConfig,
      this.template.descriptor.global?.orientation
    );
  };

  private readonly applyFpsToConfig = (): void => {
    this.project.config.videoConfig = resolveFps(this.project.config.videoConfig, this.template.descriptor.global?.fps);
  };

  construct = async (): Promise<string | null> => {
    try {
      await getPerfTimer().span('director:init', () => this.init());

      const finalPath = await this.compileVideoSegments();

      if (!this.stopBuild) {
        return finalPath;
      }
    } catch (error) {
      this.fireError(error);

      return null;
    } finally {
      // The browser / React Native event manager hands every compile the SAME emitter, so drop this
      // director's listener once its build settles — otherwise each render leaks the director through it.
      this.emitter.off?.('task-cancelled', this.onTaskCancelled);
    }

    return null;
  };

  init = async (): Promise<void> => {
    this.project.buildInfos.fileConcatPath = `${this.filesystemAdapter.getBuildDir()}/segments.list`;

    await this.musicComposer.loadMusic();

    await this.filesystemAdapter.write(this.project.buildInfos.fileConcatPath);

    this.logger.info(`[Init] Segment file saved to ${this.project.buildInfos.fileConcatPath}`);
  };

  compileVideoSegments = async (): Promise<string | null> => {
    // Guard a malformed non-array `sections` (the Node compile path doesn't validate): `?? []` only
    // covers null/undefined, so a truthy non-array would crash `.filter()` before the empty-list check.
    const allSections = (Array.isArray(this.template.descriptor.sections)
      ? this.template.descriptor.sections
      : []) as unknown as Section[];
    const videoSegments = allSections.filter((section) => VIDEO_SEGMENT_TYPES.has(section.type));

    if (videoSegments.length === 0) {
      this.logger.info('No video segments found in the template to compile.');

      return null;
    }

    const timer = getPerfTimer();

    this.buildTransitions(videoSegments);
    const needs = renderNeeds(this.template.descriptor.global, this.project.buildInfos);
    assertCanProbe(this.ffmpegAdapter, needs, videoSegments);
    await timer.span('director:calculateTotalLength', () => this.calculateTotalLength(videoSegments));

    this.logger.info(`[TemplateDirection] Length: ${this.project.buildInfos.totalLength}`);
    this.project.buildInfos.totalSegments = videoSegments.length;

    await timer.span('director:render', () => this.processVideoSegments(videoSegments));

    if (!this.stopBuild) {
      return await timer.span('director:finalize', () => this.finalizeCompilation(videoSegments));
    }

    return null;
  };

  /**
   * Builds the per-boundary transition list for the N rendering sections (N-1 boundaries, in order).
   * Each boundary takes the transition of the EARLIER section (`sections[i].transition`) or the global
   * default; a boundary is only a non-cut transition when one is declared (section or global). Cut
   * boundaries keep type 'cut' (duration 0 in timeline math). Stored on buildInfos.transitions —
   * consumed by MusicComposer (xfade-aware windows) and the final-assembly path selection.
   */
  private readonly buildTransitions = (segments: Section[]): void => {
    const globalTransition = this.template.descriptor.global?.transition;
    const transitions = this.project.buildInfos.transitions;
    transitions.length = 0;

    for (let i = 0; i < segments.length - 1; i++) {
      const declared = segments[i].transition ?? globalTransition;

      if (!declared || declared.type === 'cut') {
        transitions.push({ type: 'cut', duration: 0 });

        continue;
      }

      const duration = declared.duration ?? globalTransition?.duration ?? DEFAULT_TRANSITION_DURATION;
      transitions.push({ type: declared.type, duration });
    }
  };

  calculateTotalLength = async (segments: Section[]): Promise<void> => {
    const resolveDuration = async (segment: Section): Promise<number> => {
      if (segment.type === 'project_video') {
        return this.getVideoSectionDuration(segment);
      }

      return segment.options?.duration ?? 0;
    };

    const durations = await Promise.all(segments.map(resolveDuration));
    const durMap = this.project.buildInfos.durations;

    for (const [index, segment] of segments.entries()) {
      const duration = durations[index] ?? 0;
      this.project.buildInfos.totalLength += duration;
      durMap[segment.name] = duration;
    }

    // Each non-cut boundary cross-dissolves, overlapping its two clips and shortening the rendered
    // timeline by the transition duration. Cut boundaries subtract 0.
    this.project.buildInfos.totalLength -= this.project.buildInfos.transitions.reduce((sum, t) => sum + t.duration, 0);
  };

  getVideoSectionDuration = async (segment: Section): Promise<number> => {
    const sectionInfos = await this.fetchSectionInfos(segment);

    if (!sectionInfos.duration) {
      throw new Error('No section info found');
    }

    // Record whether the source clip carries audio so ProjectVideoSegment can add a silent track for a
    // video-only upload — otherwise the transition acrossfade later references a missing `[k:a]`.
    this.project.buildInfos.sourceHasAudio[segment.name] = sectionInfos.audioCodec !== null;

    return sectionInfos.duration;
  };

  // Render all segments: serially when concurrency resolves to 1 (single-engine adapters / opt-out),
  // else build serially + render through a bounded pool — see renderSegments.
  processVideoSegments = (segments: Section[]): Promise<void> =>
    renderSegments({
      segments,
      logger: this.logger,
      isStopped: () => this.stopBuild,
      supportsConcurrentExecute: this.ffmpegAdapter.supportsConcurrentExecute,
      maxRenderConcurrency: this.project.config.hardwareConfig?.maxRenderConcurrency,
      totalLength: this.project.buildInfos.totalLength,
      durations: this.project.buildInfos.durations,
      // Adapters that read raw elapsed time from FFmpeg (the on-device CLI's `-progress`) use the
      // expected duration to produce the 0..1 fraction forwarded to the listener.
      setSegmentProgress: (listener, expectedSeconds) => {
        this.ffmpegAdapter.progressListener = listener;
        this.ffmpegAdapter.expectedDurationSeconds = expectedSeconds;
      },
      emitProgress: (fraction) => this.emitter.emit('compilation-progress', fraction),
      processSegment: (section) => this.processSingleVideoSegment(section),
      build: async (section) => (await this.concreteBuilder.build(section, this.project.config)).segment,
      render: (segment, section) => this.concreteBuilder.render(segment, section),
      afterRender: (section) => {
        this.updateProgress(section);
        this.logger.info(`[${section.name}][Editing] finalized (${Math.round(this.project.progress * 100)}%)`);
      },
      finalizeSegment: async (section) => {
        this.musicComposer.prepareMusicTrack(section);
        await this.append(section);
      },
    });

  processSingleVideoSegment = async (segment: Section): Promise<boolean> => {
    try {
      await this.addToQueue(segment);
      this.updateProgress(segment);
      this.logger.info(`[${segment.name}][Editing] finalized (${Math.round(this.project.progress * 100)}%)`);

      return true;
    } catch (error) {
      this.fireError(error);

      return false;
    }
  };

  updateProgress = (segment: Section): void => {
    const { totalLength, durations } = this.project.buildInfos;
    const segmentLength = durations[segment.name] ?? 0;

    this.project.progress = Math.min(1, this.project.progress + segmentLength / totalLength);
    this.project.buildInfos.currentProgress = this.project.progress;

    this.emitter.emit('compilation-progress', this.project.progress);
  };

  finalizeCompilation = async (segments: Section[]): Promise<string | null> => {
    const transitions = this.project.buildInfos.transitions;
    const global = this.template.descriptor.global;
    const { hasTransition, hasAnimations, musicWillRun } = renderNeeds(global, this.project.buildInfos);
    const buildDir = this.filesystemAdapter.getBuildDir() ?? 'build';

    return runFinalize({
      segments,
      hasTransition,
      hasAnimations,
      musicEnabled: Boolean(global?.musicEnabled),
      musicWillRun,
      normalizeWillRun: !global?.musicEnabled && this.musicComposer.hasNormalization(),
      disableFold: Boolean(process.env.FVC_DISABLE_CONCAT_FOLD),
      finalPath: `${buildDir}/output.mp4`,
      listPath: this.project.buildInfos.fileConcatPath,
      setFinalVideo: (path) => {
        this.project.finalVideo = path;
      },
      getFinalVideo: () => this.project.finalVideo,
      // Assemble: plain concat (stream-copy) when no boundary needs a cross-dissolve, else xfade.
      // `.concat` is read via a bound ref so the call site isn't mistaken for Array.prototype.concat.
      assemble: () =>
        getPerfTimer().span('final:assemble', () => {
          if (hasTransition) {
            return this.videoEditor.assembleWithTransitions(this.project.buildInfos.videoInputs, transitions);
          }

          const concatVideo = this.videoEditor.concat.bind(this.videoEditor);

          return concatVideo();
        }),
      normalizeAudio: (finalVideo, source) => {
        if (source) {
          return getPerfTimer().span('final:normalize', () => this.musicComposer.normalizeAudio(finalVideo, source));
        }

        return this.musicComposer.normalizeAudio(finalVideo);
      },
      finalize: (segs, source) => this.videoEditor.finalize(segs, source),
    });
  };

  // Resolve a section's clip source and read its media info, falling back to the declared duration when
  // the probe can't (see sectionInfos.ts). Kept as a method so the director's tests exercise it directly.
  fetchSectionInfos = (section: Section): Promise<FFMpegInfos> =>
    fetchSectionInfos(
      {
        config: this.project.config,
        ffmpegAdapter: this.ffmpegAdapter,
        filesystemAdapter: this.filesystemAdapter,
        logger: this.logger,
      },
      section
    );

  addToQueue = async (section: Section): Promise<void> => {
    const { segment } = await this.concreteBuilder.build(section, this.project.config);

    await this.concreteBuilder.render(segment, section);

    this.musicComposer.prepareMusicTrack(section);
    await this.append(section);
  };

  append = async (section: Section): Promise<void> => {
    const file = segmentOutputPath(this.filesystemAdapter.getBuildDir(), section.name);
    this.project.buildInfos.videoInputs.push(file);

    await this.filesystemAdapter.append(this.project.buildInfos.fileConcatPath, `file ${file}\n`);

    this.logger.info(`[${section.name}][Append] '${file}'`);
  };

  fireError = (error: unknown): void => {
    const errorMessage = error instanceof Error ? `${error.message}\n${error.stack}` : JSON.stringify(error);
    this.logger.error(`[TemplateDirector][Error] ${errorMessage}`);

    this.stopBuild = true;
    this.filesystemAdapter.unlink(this.project.buildInfos.fileConcatPath).catch(() => {});
    this.emitter.emit('task-stopped', error);
  };
}

export default TemplateDirector;
