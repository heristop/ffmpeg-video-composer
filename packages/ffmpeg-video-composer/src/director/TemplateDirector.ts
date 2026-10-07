import { inject, injectable, registry, type DependencyContainer } from 'tsyringe';

import type AbstractLogger from '../platform/logging/AbstractLogger';
import type AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import type AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import type AbstractEventManager from '../platform/AbstractEventManager';
import type { IEventEmitter } from '../platform/AbstractEventManager';
import type VideoEditor from '../editor/VideoEditor';
import type MusicComposer from '../editor/MusicComposer';
import type { FFMpegInfos, ProjectConfig, Section, TemplateDescriptor } from '@/core/types';
import { fetchSectionInfos, segmentOutputPath } from './section-infos';
import { applyTakePlans, recordProbe, type FootagePlanDeps } from './footage-plan';
import { getPerfTimer } from '../utils/perf-timer';
import { renderSegments } from './render-segments-concurrently';
import { runFinalize } from './finalize-concat-fold';
import {
  awaitsBeatsAnalysis,
  boundaryTransitions,
  discardOutput,
  expandForBuild,
  logVideoPaths,
  prepareMeasuredMotion,
  prepareMotion,
  publishOutput,
  qcExpectations,
  recordBuildCommands,
  resolveBuildVideoConfig,
  resolveOutputPaths,
  timingOptions,
  type TimingOptions,
} from './prepare-build';
import { assertCanProbe, renderNeeds } from './render-needs';
import { recordSectionLengths } from './footage-durations';
import { VIDEO_SEGMENT_TYPES } from '../editor/utils/section-types';
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
  // Set when global.beats asks for a music analysis: the time references resolve in init(), once the
  // music track is on disk and measured (beats-analysis.ts).
  private pendingTiming: TimingOptions | null = null;

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
    // The clone the build compiles: partials expanded, then the requested format's composition, before
    // any other pass (prepare-build.ts, core/formats).
    const expanded = expandForBuild(templateDescriptor, this.logger, projectConfig.format, projectConfig.fields);
    this.template.descriptor = expanded;
    this.project.config = projectConfig;

    // Reset ALL build-accumulated state at the start of every compile() (config() runs first), so
    // back-to-back compiles in one long-lived process (browser / on-device) are independent — see
    // Project.resetBuildState for why (the videoInputs cascade).
    this.project.resetBuildState();

    this.filesystemAdapter.setBuildDir(this.project.config.buildDir ?? 'build');
    this.filesystemAdapter.setAssetsDir(this.project.config.assetsDir ?? 'assets');

    this.project.applyDefault();
    // Resolve orientation + fps ONCE, here — the single point where the descriptor and the project config meet.
    this.project.config.videoConfig = resolveBuildVideoConfig(
      this.project.config.videoConfig,
      this.template.descriptor
    );
    // Resolve $tokens, energy and time references once, before any lowering, against the resolved
    // frame, locale and fields (prepare-build.ts) — after the music analysis when the beats await one.
    const timing = timingOptions(this.project.config);
    this.pendingTiming = awaitsBeatsAnalysis(expanded) ? timing : null;
    this.template.descriptor = this.pendingTiming ? expanded : prepareMotion(expanded, timing);

    logVideoPaths(this.project.config, this.logger);

    return this;
  };

  construct = async (): Promise<string | null> => {
    // Deterministic encoder profile + command record for the render manifest (director/prepare-build.ts).
    const restoreAdapter = recordBuildCommands(this.ffmpegAdapter, this.project);

    try {
      await getPerfTimer().span('director:init', () => this.init());

      const finalPath = await this.compileVideoSegments();

      if (!this.stopBuild) {
        return await publishOutput(this.filesystemAdapter, this.project.output, finalPath);
      }
    } catch (error) {
      this.fireError(error);
    } finally {
      restoreAdapter();
      // The browser / React Native event manager hands every compile the SAME emitter, so drop this
      // director's listener once its build settles — otherwise each render leaks the director through it.
      this.emitter.off?.('task-cancelled', this.onTaskCancelled);
    }

    // Failed or cancelled: never leave a half-written output behind (director/output-staging.ts).
    await discardOutput(this.filesystemAdapter, this.project.output);

    return null;
  };

  init = async (): Promise<void> => {
    this.project.buildInfos.fileConcatPath = `${this.filesystemAdapter.getBuildDir()}/segments.list`;
    this.project.output = resolveOutputPaths(this.filesystemAdapter.getBuildDir() ?? 'build', this.ffmpegAdapter);

    await this.musicComposer.loadMusic();

    if (this.pendingTiming) await prepareMeasuredMotion(this.template, this.project, this.pendingTiming);

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

    const { global } = this.template.descriptor;
    const fps = this.project.config.videoConfig?.fps ?? 30;
    this.project.qcExpectations = qcExpectations(videoSegments, this.project.buildInfos, global, fps);
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
    const declared = this.template.descriptor.global?.transition;
    const crossfade = this.project.engineFeatures?.missingFilters?.has('xfade') !== true;
    this.project.buildInfos.transitions.splice(0, Infinity, ...boundaryTransitions(segments, declared, crossfade));
  };

  calculateTotalLength = async (segments: Section[]): Promise<void> => {
    const buildInfos = this.project.buildInfos;
    const sourceDurations = (buildInfos.sourceDurations ??= {});
    const probes = segments.filter((segment) => segment.type === 'project_video');
    const probed = await Promise.all(probes.map((segment) => this.getVideoSectionDuration(segment)));

    for (const [index, segment] of probes.entries()) sourceDurations[segment.name] = probed[index];

    // Order: probed source → clip range / ramp / freeze (director/footage-durations.ts) → keep windows /
    // trimSilence / HDR tone-map (director/footage-plan.ts). The two edit families never share a section.
    const fps = this.project.config.videoConfig?.fps ?? 30;
    recordSectionLengths(segments, buildInfos, fps, (note) => {
      this.logger.warn(note);
    });
    await applyTakePlans(this.footageDeps(), segments, buildInfos);

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
    recordProbe(this.project.buildInfos, segment.name, sectionInfos);

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
      // Without a music mix, normalisation and sound effects need their own audio pass.
      normalizeWillRun: !musicWillRun && this.musicComposer.hasStandaloneAudioPass(),
      disableFold: Boolean(process.env.FVC_DISABLE_CONCAT_FOLD),
      finalPath: this.project.output.staging || `${buildDir}/output.mp4`,
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
  fetchSectionInfos = (section: Section): Promise<FFMpegInfos> => fetchSectionInfos(this.footageDeps(), section);

  private readonly footageDeps = (): FootagePlanDeps => ({
    config: this.project.config,
    ffmpegAdapter: this.ffmpegAdapter,
    filesystemAdapter: this.filesystemAdapter,
    logger: this.logger,
    mediaCache: this.template.assets.inputs as unknown as Record<string, string>,
    analyzer: this.project.footageAnalyzer,
  });

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
