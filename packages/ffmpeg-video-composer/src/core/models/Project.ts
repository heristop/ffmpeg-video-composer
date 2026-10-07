import { singleton } from 'tsyringe';
import type { ProjectBuildInfos, ProjectConfig } from '../types';
import DefaultConfig from '../default.config';
import type { LoudnessReport, QcExpectations } from '../qc/types';
import type { CommandInterceptor } from '../determinism/command-tap';
import type { FootageAnalyzer } from '../footage/analyzer';
import type { EngineFeatures } from '../capabilities';

@singleton()
class Project {
  public config: ProjectConfig = {};
  public buildInfos: ProjectBuildInfos = {
    totalSegments: 0,
    totalLength: 0,
    currentLength: 0,
    currentProgress: 0,
    currentIncrement: 0,
    durations: {},
    sourceHasAudio: {},
    sourceDurations: {},
    videoInputs: [],
    musicInputs: [],
    musicFilters: [],
    fileConcatPath: '',
    musicPath: '',
    transitions: [],
  };
  public finalVideo = '';
  public progress = 0;
  public errors: string[] = [];
  // Every FFmpeg command the current build ran (after the deterministic profile), for the render
  // manifest. Filled by director/prepare-build.ts, cleared with the rest of the build state.
  public ffmpegCommands: string[] = [];
  // Read by the Node epilogue after the director returns, so they live outside buildInfos (which clean()
  // resets): the output QC's expectations and the loudness normalisation actually applied.
  public qcExpectations: QcExpectations | null = null;
  public loudness: LoudnessReport | null = null;
  // Where the final passes write and where the result is published (director/output-staging.ts).
  public output = { staging: '', final: '' };
  // Set by the Node compile() after config(): the detected FFmpeg version (colour-tag flags, see
  // core/encoding.ts) and the section-cache hook the command tap routes through (null elsewhere).
  public ffmpegVersion: string | null = null;
  // What the probed binary can run (editor/utils/filter-compat.ts): its text libraries (`-buildconf`,
  // driving drawtext `text_shaping`) and, from the Node capability probe, the filters it lacks (dropped
  // with a warning, designed transitions cut). Null where nothing was probed (browser, device).
  public engineFeatures: EngineFeatures | null = null;
  public commandInterceptor: CommandInterceptor | null = null;
  // Set by the Node compile() too: silencedetect + filter-list analysis for footage edits (null elsewhere).
  public footageAnalyzer: FootageAnalyzer | null = null;

  constructor() {
    this.init();
  }

  init = (): void => {
    this.buildInfos = {
      totalSegments: 0,
      totalLength: 0,
      currentLength: 0,
      currentProgress: 0,
      currentIncrement: 0,
      durations: {},
      sourceHasAudio: {},
      sourceDurations: {},
      videoInputs: [],
      musicInputs: [],
      musicFilters: [],
      fileConcatPath: '',
      musicPath: '',
      transitions: [],
    };
  };

  /**
   * Clear every field a build accumulates, at the START of the next compile. This is a singleton
   * (registerInstance) reused across compiles in a long-lived process (browser / on-device), and
   * emitFinalize skips clean() whenever `errors` is non-empty — so without this, an errored compile
   * leaves stale state (and a non-empty `errors` that permanently disables clean()) that corrupts
   * every later compile. The load-bearing field is `videoInputs`: append() PUSHES each rendered
   * segment path to it, so a leftover entry makes the next compile's transition assembly probe a
   * prior build's segment ("[Transitions] could not probe duration"). Cleared IN PLACE (arrays/maps
   * mutated, not reassigned) so any component holding this same instance keeps seeing the live fields.
   */
  resetBuildState = (): void => {
    const bi = this.buildInfos;
    Object.assign(bi, { totalSegments: 0, totalLength: 0, currentLength: 0, currentProgress: 0, currentIncrement: 0 });
    bi.videoInputs.length = bi.musicInputs.length = bi.musicFilters.length = bi.transitions.length = 0;
    bi.durations = {};
    bi.sourceHasAudio = {};
    bi.footage = {};
    bi.sourceDurations = {};
    // loadMusic leaves musicPath untouched when no track resolves, and it may still hold the last build's loop copy.
    bi.musicPath = '';
    this.errors.length = 0;
    this.ffmpegCommands.length = 0;
    this.finalVideo = '';
    this.qcExpectations = this.loudness = this.ffmpegVersion = this.commandInterceptor = this.footageAnalyzer = null;
    this.engineFeatures = null;
    this.output = { staging: '', final: '' };
  };

  // Per-block merge: a caller-provided block only overrides the fields it names, every other
  // field keeps its default, and config keys outside the four blocks pass through untouched.
  // The raw config is spread FIRST so the merged blocks win — a trailing spread would re-apply
  // the caller's raw partial blocks and silently drop the remaining defaults (a partial
  // `audioConfig: { sampleRate }` used to lose channelLayout and break addBlankAudio's anullsrc).
  applyDefault = () => {
    this.config = {
      ...this.config,
      codecConfig: {
        videoCodec: DefaultConfig.VIDEO_CODEC,
        audioCodec: DefaultConfig.AUDIO_CODEC,
        ...this.config.codecConfig,
      },
      hardwareConfig: {
        hwaccel: DefaultConfig.HWACCEL,
        preset: DefaultConfig.PRESET,
        ...this.config.hardwareConfig,
      },
      audioConfig: {
        sampleRate: DefaultConfig.SAMPLE_RATE,
        channelLayout: DefaultConfig.CHANNEL_LAYOUT,
        ...this.config.audioConfig,
      },
      videoConfig: {
        orientation: DefaultConfig.ORIENTATION,
        scale: DefaultConfig.SCALE,
        setsar: DefaultConfig.SETSAR,
        ...this.config.videoConfig,
      },
      currentLocale: this.config.currentLocale ?? DefaultConfig.CURRENT_LOCALE,
    };
  };

  clean = (): void => {
    this.init();
  };
}

export default Project;
