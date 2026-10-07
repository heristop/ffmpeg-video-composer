import { container, inject, injectable } from 'tsyringe';
import { assertSafeArgToken } from '@/core/arg-guard';
import type { MusicConfig, Section } from '@/core/types';
import { DEFAULT_TRANSITION_DURATION } from '../schemas/effects.schemas';
import type AbstractLogger from '../platform/logging/AbstractLogger';
import type AbstractFFmpeg from '../platform/ffmpeg/AbstractFFmpeg';
import type AbstractFilesystem from '../platform/filesystem/AbstractFilesystem';
import type AbstractMusic from '../platform/ffmpeg/AbstractMusic';
import type Template from '../core/models/Template';
import type Project from '../core/models/Project';
import { resolveVideoInput, type VideoSource } from './utils/video-input';
import { resolveMusicFade } from './utils/music-fade';
import { finalizeLeg, type PendingLeg } from './utils/music-leg';
import { formatMusicName, removeExtension } from './utils/music-name';
import { musicAssetUrl } from '@/core/asset-source';
import { loudnessTarget, musicMixGraph, musicPassBound, normalizeSuffix, sfxOnlyGraph } from './utils/music-mix';
import { normalizeWithTruePeakGuard } from './utils/true-peak-guard';
import { descriptorHasSfx, prepareSfxStage, type SfxStage } from './utils/sfx-stage';

type AppendMusicOptions = {
  videoInputArgs: string;
  segments: Section[];
  finalVideo: string;
  audioVolumeLevel: number;
  reduceNoiseConfig: string;
  sampleRate: number | undefined;
  hasSegmentAudio: boolean;
  sfx: SfxStage | null;
};

type SfxBed = { hasSegmentAudio: boolean; ceiling?: number };

@injectable()
class MusicComposer {
  private buildAssetsDir = '';
  private musicAssetsDir = '';

  // Memoized result of resolveMusicFade — computed once per build since it only depends on
  // instance-constant inputs (the descriptor's configured musicFade/transition, and the section list).
  private resolvedMusicFade: number | null = null;

  // The most recently seen section whose true video-timeline advance is still unknown (it depends on
  // the transition into the NEXT section — see prepareMusicTrack/finalizeLeg). null once flushed.
  private pendingLeg: PendingLeg | null = null;

  private readonly project: Project;
  private readonly template: Template;
  private readonly logger: AbstractLogger;
  private readonly ffmpegAdapter: AbstractFFmpeg;
  private readonly filesystemAdapter: AbstractFilesystem;
  private readonly musicAdapter: AbstractMusic;

  constructor(
    @inject('project') project: Project,
    @inject('template') template: Template,
    @inject('logger') logger: AbstractLogger,
    @inject('ffmpegAdapter') ffmpegAdapter: AbstractFFmpeg,
    @inject('filesystemAdapter') filesystemAdapter: AbstractFilesystem
  ) {
    this.project = project;
    this.template = template;
    this.logger = logger;
    this.ffmpegAdapter = ffmpegAdapter;
    this.filesystemAdapter = filesystemAdapter;
    this.musicAdapter = container.resolve<AbstractMusic>('musicAdapter');
  }

  // Resolve the active music config — from project config, else the template's global.music. null = none.
  private ensureMusicConfig(): MusicConfig | null {
    if (this.project.config.music) {
      return this.project.config.music;
    }

    const fromTemplate = this.template.descriptor.global?.music;

    if (fromTemplate) {
      this.project.config.music = fromTemplate;

      return fromTemplate;
    }

    return null;
  }

  /**
   * Load background music track from cache or download
   */
  loadMusic = async (): Promise<void> => {
    this.buildAssetsDir = await this.filesystemAdapter.getBuildPath('assets');
    this.musicAssetsDir = await this.filesystemAdapter.getAssetsPath('musics');

    const music = this.ensureMusicConfig();

    if (!music) {
      return;
    }

    const musicFormattedName = formatMusicName(music);

    const cachedPath = await this.resolveCachedMusic(music, musicFormattedName);

    if (cachedPath) {
      this.logger.info(`[Music] Loaded from cache ${cachedPath}`);
      this.project.buildInfos.musicPath = cachedPath;

      return;
    }

    this.project.buildInfos.musicPath = await this.resolveBundledOrDownloadedMusic(music, musicFormattedName);
  };

  // Prefer a track shipped with the package (resolved locally on Node) over a network download —
  // mirrors bundled-font resolution, so `global.music: { name }` works offline on Node/server/MCP.
  private async resolveBundledOrDownloadedMusic(music: MusicConfig, formattedName: string): Promise<string> {
    const bundled = await this.filesystemAdapter.resolveBundledMusic(`${formattedName}.mp3`);

    if (bundled) {
      this.logger.info(`[Music] bundled ${bundled}`);

      return bundled;
    }

    // A catalog track is fetched by name from the asset source (GitHub by default, see asset-source.ts)
    // rather than bundling the ~104 MB library. Only an ABSOLUTE http(s) `url` is a real download
    // source; a relative `url` (e.g. `musics/point-being.mp3`, the catalog templates' assets-dir hint)
    // is not fetchable — treat it as a name and resolve via the asset source, or the Node adapter would
    // `realpath`-crash trying to read it as a local file.
    const isRemoteUrl = /^https?:\/\//i.test(music.url ?? '');
    const url = isRemoteUrl ? (music.url as string) : musicAssetUrl(`${formattedName}.mp3`);
    this.logger.info(`[Music] Fetching ${url}`);
    const destination = `${this.buildAssetsDir}/${formattedName}.mp3`;
    await this.downloadAndSaveMusic(url, destination);

    return destination;
  }

  // Resolve a bundled music file from the local assets dir. Tries the configured (display) name first,
  // then the URL's own basename — the bundled library names files after the URL, not the display name,
  // so a template like { name: 'popopop', url: '.../pop.mp3' } still resolves to the local pop.mp3
  // instead of forcing a network download.
  private async resolveCachedMusic(music: MusicConfig, formattedName: string): Promise<string | null> {
    const byName = `${this.musicAssetsDir}/${formattedName}.mp3`;

    if (await this.checkMusicExists(byName)) {
      return byName;
    }

    const urlName = music.url ? removeExtension(music.url.split('/').at(-1) ?? '') : '';

    if (urlName && urlName !== formattedName) {
      const byUrl = `${this.musicAssetsDir}/${urlName}.mp3`;

      if (await this.checkMusicExists(byUrl)) {
        return byUrl;
      }
    }

    return null;
  }

  private async downloadAndSaveMusic(url: string, destination: string): Promise<void> {
    const musicPath = await this.downloadMusic(url);
    await this.filesystemAdapter.move(musicPath, destination);
    this.logger.info(`[Music] Fetched ${destination}`);
  }

  private async downloadMusic(url: string): Promise<string> {
    return await this.filesystemAdapter.fetch(url);
  }

  private async checkMusicExists(filePath: string): Promise<boolean> {
    return await this.filesystemAdapter.stat(filePath);
  }

  // The RENDERED length of a section, matching what actually ends up on the video timeline (and
  // what the xfade assembly's own probe of the rendered file sees) — NOT necessarily the declared
  // length. `ProjectVideoSegment` trims a `project_video` clip with `-t options.duration -shortest`,
  // so the true rendered length is `min(declared, probed-clip-length)`. calculateTotalLength stores
  // the RAW probed clip length (uncapped by the declared duration) in buildInfos.durations for a
  // project_video; for every other section type it stores the declared duration verbatim (there's no
  // separate source clip to trim against), so `declared` and `probed` already agree there.
  private renderedSectionDuration(section: Section): number {
    const declared = section.options?.duration ?? 0;
    const probed = this.project.buildInfos.durations[section.name] ?? 0;

    if (declared > 0 && probed > 0) {
      return Math.min(declared, probed);
    }

    return probed || declared;
  }

  // Per-section override wins; otherwise fall back to the template-wide music level (the builder's
  // music slider), then the engine default. 0 = silent music.
  private resolveMusicVolumeLevel(section: Section): number {
    return section.options?.musicVolume ?? this.template.descriptor.global?.audio?.musicVolume ?? 0.5;
  }

  // Memoized ONCE per build (see ./utils/music-fade): decouples the music leg-to-leg blend from
  // transitionDuration, which afade in/out still use as-is (a video-synced fade to/from silence at
  // the start/end, not a leg blend, so it has no reason to track this).
  private resolveTransitionAndFade(): { transitionDuration: number; musicFade: number } {
    const transitionDuration = this.template.descriptor.global?.transition?.duration ?? DEFAULT_TRANSITION_DURATION;
    const durations = this.project.buildInfos.durations;
    // durations is fully populated by calculateTotalLength before any section reaches
    // prepareMusicTrack, so it's stable for the memoized lifetime of resolvedMusicFade.
    this.resolvedMusicFade ??= resolveMusicFade(this.template.descriptor, transitionDuration, durations);
    const musicFade = this.resolvedMusicFade;

    return { transitionDuration, musicFade };
  }

  /**
   * Configure audio filters for video segment.
   *
   * Each non-cut boundary overlaps its two VIDEO clips (xfade), shortening the rendered video
   * timeline by that boundary's effective (capped) transition duration. The music track must track
   * that SAME compressed timeline, or its volume envelope (e.g. a flash-card's louder `musicVolume`)
   * drifts later and later relative to the section it's meant to cover — this is the bug this method
   * fixes (see ./utils/music-leg for the arithmetic).
   *
   * A leg's own advance depends on the transition into the NEXT section, so it can't be finalized
   * (pushed to musicFilters) until that next section's duration is known. Each call therefore
   * finalizes the PREVIOUS section (now that this section's duration closes the gap) before storing
   * itself as the new pending leg — except the last section, which has no outgoing boundary to wait
   * for and finalizes immediately. `musicFilters` is joined into one `-filter_complex` string later
   * (in buildFilterComplex), so pushing leg N's own filter one call after leg N started doesn't
   * matter — ffmpeg's filtergraph parser links labels regardless of statement order.
   */
  prepareMusicTrack = (section: Section): void => {
    const musicVolumeLevel = this.resolveMusicVolumeLevel(section);
    const { transitionDuration, musicFade } = this.resolveTransitionAndFade();

    const duration = this.renderedSectionDuration(section);

    const sectionIncrement = this.project.buildInfos.currentIncrement + 1;
    const isLastSection = sectionIncrement === this.project.buildInfos.totalSegments;
    const mapName = isLastSection ? 'lastsection' : `section${sectionIncrement}`;

    this.project.buildInfos.currentIncrement = sectionIncrement;

    // This section's duration is exactly what the PREVIOUS (pending) leg was waiting for — finalize
    // it now, which also advances currentLength to this leg's correct start.
    if (this.pendingLeg) {
      this.pushFinalizedLeg(this.pendingLeg, duration, transitionDuration, musicFade);
      this.pendingLeg = null;
    }

    const leg: PendingLeg = {
      ss: this.project.buildInfos.currentLength,
      duration,
      sectionIncrement,
      musicVolumeLevel,
      mapName,
    };

    if (isLastSection) {
      // No outgoing boundary to wait for — finalize immediately (advance = its own full duration).
      this.pushFinalizedLeg(leg, null, transitionDuration, musicFade);

      return;
    }

    this.pendingLeg = leg;
  };

  // Resolves the leg's filter + crossfade via ./utils/music-leg (pure), then applies its side
  // effects: pushes both filter strings and advances currentLength to the leg's true video-timeline
  // advance.
  private pushFinalizedLeg(
    leg: PendingLeg,
    nextDuration: number | null,
    transitionDuration: number,
    musicFade: number
  ): void {
    const transition = this.project.buildInfos.transitions[leg.sectionIncrement - 1];
    const resolved = finalizeLeg(leg, nextDuration, transition, transitionDuration, musicFade);

    this.project.buildInfos.musicFilters.push(` ${resolved.filter}`);

    if (resolved.crossfade) {
      this.project.buildInfos.musicFilters.push(resolved.crossfade);
    }

    this.project.buildInfos.currentLength = resolved.nextCurrentLength;
  }

  // The loudnorm guard's true-peak probe of the encoded output, where the adapter can measure (Node).
  private truePeakProbe(file: string): (() => Promise<number | null>) | undefined {
    const adapter = this.ffmpegAdapter;
    const measure = adapter.measureTruePeak?.bind(adapter);

    return measure ? () => measure(file) : undefined;
  }

  // Runs one audio pass; with loudnorm, through the true-peak guard (utils/true-peak-guard.ts), whose
  // report is kept for the render manifest and the output QC.
  private async runNormalizedPass(finalVideo: string, run: (ceiling?: number) => Promise<void>): Promise<void> {
    if (this.template.descriptor.global?.audio?.normalize !== 'loudnorm') {
      await run();

      return;
    }

    const target = loudnessTarget(this.template.descriptor.global).truePeak;

    this.project.loudness = await normalizeWithTruePeakGuard({ run, measure: this.truePeakProbe(finalVideo), target });
    const { ceiling, measured, retries } = this.project.loudness;
    this.logger.info(
      `[Music][Normalize] loudnorm TP=${ceiling} (measured ${measured ?? '?'} dBTP, ${retries} retries)`
    );
  }

  private buildAppendMusicCommand(opts: AppendMusicOptions, ceiling?: number): string {
    const channelConfig = `aformat=sample_fmts=fltp:sample_rates=${opts.sampleRate}:channel_layouts=stereo`;
    const filterComplex = musicMixGraph({
      global: this.template.descriptor.global,
      musicFilters: this.project.buildInfos.musicFilters,
      multipleSegments: opts.segments.length > 1,
      audioVolumeLevel: opts.audioVolumeLevel,
      reduceNoiseConfig: opts.reduceNoiseConfig,
      channelConfig,
      hasSegmentAudio: opts.hasSegmentAudio,
      ceiling,
      // Inputs: 0 the video, 1 the music, then one per distinct sound effect.
      sfx: opts.sfx?.graph(2, channelConfig),
    });

    let command = ` -y ${opts.videoInputArgs} -i ${this.project.buildInfos.musicPath}${opts.sfx?.inputArgs ?? ''} `;
    command += ` -filter_complex "${filterComplex}" `;
    // +faststart so the music-mixed final output previews in a browser <video> (moov to the front),
    // matching the concat/single-file paths. The bound ends the output at the planned timeline length
    // (the music legs' currentLength, see utils/music-mix.ts musicPassBound) so a longer music tail
    // (e.g. after loopMusic overshoots, or a music-only graph) never extends it past the video.
    const bound = musicPassBound(this.project.buildInfos.currentLength);
    command += ` -map 0:v -map "[final]" -c:v copy -c:a aac -ac 2 -movflags +faststart ${bound} ${opts.finalVideo} `;

    return command;
  }

  private async executeAudioPass(command: string, label: string, failure: string): Promise<void> {
    this.logger.debug(`[${label}][Command] ffmpeg ${command}`);
    const result = await this.ffmpegAdapter.execute(command);
    this.logger.info(`[${label}] ffmpeg process exited with rc ${result.rc}`);

    if (result.rc === 1) {
      throw new Error(failure);
    }
  }

  /**
   * Mix background music with video audio
   */
  appendMusic = async (segments: Section[], finalVideo: string, videoSource?: VideoSource): Promise<void> => {
    // Fail fast, BEFORE resolveVideoInput moves the final video aside: the mix command is
    // space-split by parseCommand, so a path with raw whitespace would silently mis-tokenize.
    assertSafeArgToken(this.project.buildInfos.musicPath, 'music path');
    const source: VideoSource = videoSource ?? { kind: 'file', path: finalVideo };

    const resolved = await resolveVideoInput(source, this.filesystemAdapter, 'tmp_video');
    const { videoInputArgs, probeTarget, tempToClean } = resolved;

    // Probe for an audio stream (a video-only upload has none) so the filtergraph doesn't reference a
    // missing `[0:a]`. For concat, probeTarget is the first segment — uniform streams match the whole.
    const hasSegmentAudio = (await this.ffmpegAdapter.getInfos(probeTarget)).audioCodec !== null;

    const options: AppendMusicOptions = {
      videoInputArgs,
      segments,
      finalVideo,
      audioVolumeLevel: this.template.descriptor.global?.audio?.sourceVolume ?? 1,
      reduceNoiseConfig: 'afftdn=nr=20:nf=-20',
      sampleRate: this.project.config.audioConfig?.sampleRate,
      hasSegmentAudio,
      sfx: await this.prepareSfx(),
    };

    await this.runNormalizedPass(finalVideo, (ceiling) =>
      this.executeAudioPass(this.buildAppendMusicCommand(options, ceiling), 'Music', 'Error on music add')
    );

    if (tempToClean) {
      await this.filesystemAdapter.unlink(tempToClean);
    }
  };

  // True when the template requests loudnorm/dynaudnorm — lets the director decide whether a
  // normalize pass will run (and thus whether the concat can fold into it) without duplicating the
  // descriptor logic.
  hasNormalization = (): boolean => normalizeSuffix(this.template.descriptor.global) !== '';

  // True when a render without music still needs its own audio pass: normalisation or sound effects.
  hasStandaloneAudioPass = (): boolean => this.hasNormalization() || descriptorHasSfx(this.template.descriptor);

  // The planned sound effects with their files resolved (utils/sfx-stage.ts), null when there are none.
  private prepareSfx(): Promise<SfxStage | null> {
    return prepareSfxStage({
      descriptor: this.template.descriptor,
      buildInfos: this.project.buildInfos,
      config: this.project.config,
      filesystem: this.filesystemAdapter,
      logger: this.logger,
    });
  }

  // The no-music pass with sound effects: the clip sound as the bed, the effects over it, then the
  // normalize filter (when requested), as one -filter_complex.
  private sfxOnlyCommand(videoInputArgs: string, finalVideo: string, sfx: SfxStage, bed: SfxBed): string {
    const channelConfig = `aformat=sample_fmts=fltp:sample_rates=${sfx.sampleRate}:channel_layouts=stereo`;
    const graph = sfxOnlyGraph(this.template.descriptor.global, sfx.graph(1, channelConfig), {
      channelConfig,
      hasSegmentAudio: bed.hasSegmentAudio,
      total: sfx.total,
      sampleRate: sfx.sampleRate,
      ceiling: bed.ceiling,
    });

    const output = ` -map 0:v -map "[final]" -c:v copy -c:a aac -ac 2 -movflags +faststart ${finalVideo} `;

    return ` -y ${videoInputArgs}${sfx.inputArgs} -filter_complex "${graph}" ${output}`;
  }

  /**
   * Apply audio normalization to a final video when music is disabled. Called after assembly when
   * global.audio.normalize is set and music is not enabled.
   *
   * Runs a single-pass normalize filter (loudnorm or dynaudnorm) via `-af`, copies the video stream,
   * and writes finalVideo. A concat `videoSource` lets it consume the segment list directly (folding
   * the standalone concat into this pass); the default file source preserves the move-in-place flow.
   * loudnorm runs through the true-peak guard, which may repeat the pass with a lower ceiling.
   */
  normalizeAudio = async (finalVideo: string, videoSource?: VideoSource): Promise<void> => {
    if (!this.hasStandaloneAudioPass()) {
      return;
    }

    const source = videoSource ?? { kind: 'file' as const, path: finalVideo };
    const input = await resolveVideoInput(source, this.filesystemAdapter, 'tmp_normalize');
    const { videoInputArgs, tempToClean } = input;
    const sfx = await this.prepareSfx();
    // Only the sound-effect mix needs to know whether the joined video carries audio (else a silent bed).
    const hasSegmentAudio = !sfx || (await this.ffmpegAdapter.getInfos(input.probeTarget)).audioCodec !== null;

    await this.runNormalizedPass(finalVideo, (ceiling) => {
      if (sfx) {
        const command = this.sfxOnlyCommand(videoInputArgs, finalVideo, sfx, { hasSegmentAudio, ceiling });

        return this.executeAudioPass(command, 'Music][Sfx', 'Error on sound effects mix');
      }

      // Strip the leading comma so it can be used as a standalone -af value.
      const afFilter = normalizeSuffix(this.template.descriptor.global, ceiling).slice(1);
      const command = ` -y ${videoInputArgs} -af "${afFilter}" -c:v copy -movflags +faststart ${finalVideo} `;

      return this.executeAudioPass(command, 'Music][Normalize', 'Error on audio normalization');
    });

    if (tempToClean) {
      await this.filesystemAdapter.unlink(tempToClean);
    }
  };

  /**
   * Loop music track to match video duration
   */
  loopMusic = async (): Promise<void> => {
    const { totalLength, musicPath } = this.project.buildInfos;
    // `loadMusic` returns early (leaving musicPath empty) when the template enables music but no track
    // is actually selected/resolved. Probing an empty path makes ffprobe fail — skip looping instead.
    if (!musicPath) {
      this.logger.info('[Music] No music track resolved — skipping loop.');

      return;
    }

    // Mix what the adapter hands back — the track itself, or its looped copy in the build dir.
    const result = await this.musicAdapter.process(this.logger, this.filesystemAdapter, totalLength, musicPath);
    this.project.buildInfos.musicPath = result.musicPath;
  };
}

export default MusicComposer;
