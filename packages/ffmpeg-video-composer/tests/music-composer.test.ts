import 'reflect-metadata';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import MusicComposer from '@/editor/MusicComposer';
import type { ProjectConfig, Section, TemplateDescriptor } from '@/core/types';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeProject(config: ProjectConfig = {}) {
  return {
    config,
    finalVideo: '',
    errors: [] as string[],
    buildInfos: {
      totalSegments: 0,
      totalLength: 0,
      currentLength: 0,
      currentProgress: 0,
      currentIncrement: 0,
      durations: {} as Record<string, number>,
      videoInputs: [] as string[],
      musicInputs: [] as string[],
      musicFilters: [] as string[],
      fileConcatPath: '',
      musicPath: '',
      transitions: [] as Array<{ type: string; duration: number }>,
    },
  };
}

function makeTemplate(descriptor: TemplateDescriptor = {}) {
  return { descriptor, assets: { fonts: {}, musics: {}, inputs: [] } };
}

function makeFilesystem() {
  return {
    getBuildPath: vi.fn(async () => '/build/assets'),
    getAssetsPath: vi.fn(async () => '/cache/musics'),
    getTempDir: vi.fn(() => '/tmp'),
    stat: vi.fn(async () => false),
    fetch: vi.fn(async () => '/downloads/track.mp3'),
    read: vi.fn(async () => "file '/build/intro_output.mp4'\nfile '/build/clip_output.mp4'"),
    move: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    // Default to "not bundled" so the URL-download path is still exercised by existing tests.
    resolveBundledMusic: vi.fn(async (): Promise<string | null> => null),
  };
}

let musicAdapter: { process: ReturnType<typeof vi.fn> };

function makeComposer(
  opts: {
    project?: ReturnType<typeof makeProject>;
    template?: ReturnType<typeof makeTemplate>;
    filesystem?: ReturnType<typeof makeFilesystem>;
    ffmpeg?: { execute: ReturnType<typeof vi.fn>; getInfos?: ReturnType<typeof vi.fn> };
  } = {}
) {
  const project = opts.project ?? makeProject();
  const template = opts.template ?? makeTemplate();
  const filesystem = opts.filesystem ?? makeFilesystem();
  const ffmpeg = opts.ffmpeg ?? {
    execute: vi.fn(async () => ({ rc: 0 })),
    // appendMusic probes the concat output for an audio stream; default to "has audio".
    getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
  };
  const logger = makeLogger();

  // Defaults to "long enough already": the adapter hands back the source path it was given.
  musicAdapter = {
    process: vi.fn(async (_logger: unknown, _fs: unknown, _totalLength: number, musicPath: string) => ({
      rc: 0,
      musicPath,
    })),
  };
  container.registerInstance('musicAdapter', musicAdapter);

  const composer = new MusicComposer(
    project as never,
    template as never,
    logger as never,
    ffmpeg as never,
    filesystem as never
  );

  return { composer, project, template, filesystem, ffmpeg, logger };
}

beforeEach(() => {
  vi.clearAllMocks();
  container.clearInstances();
});

describe('MusicComposer.loadMusic', () => {
  it('returns early when no music is configured anywhere', async () => {
    const { composer, project } = makeComposer();

    await composer.loadMusic();

    expect(project.buildInfos.musicPath).toBe('');
  });

  it('falls back to template global music when project config has none', async () => {
    const template = makeTemplate({ global: { music: { name: 'epic.mp3' } } });
    const filesystem = makeFilesystem();
    filesystem.stat.mockResolvedValue(true); // exists in cache
    const { composer, project } = makeComposer({ template, filesystem });

    await composer.loadMusic();

    expect(project.config.music).toEqual({ name: 'epic.mp3' });
    expect(project.buildInfos.musicPath).toBe('/cache/musics/epic.mp3');
  });

  it('loads music from cache when the file already exists', async () => {
    const project = makeProject({ music: { name: 'song.mp3' } });
    const filesystem = makeFilesystem();
    filesystem.stat.mockResolvedValue(true);
    const { composer, logger } = makeComposer({ project, filesystem });

    await composer.loadMusic();

    expect(project.buildInfos.musicPath).toBe('/cache/musics/song.mp3');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Loaded from cache'));
    expect(filesystem.fetch).not.toHaveBeenCalled();
  });

  it('downloads and saves music from a URL when not cached', async () => {
    const project = makeProject({ music: { name: 'remote', url: 'https://cdn.test/remote.mp3' } });
    const filesystem = makeFilesystem();
    filesystem.stat.mockResolvedValue(false);
    const { composer } = makeComposer({ project, filesystem });

    await composer.loadMusic();

    expect(filesystem.fetch).toHaveBeenCalledWith('https://cdn.test/remote.mp3');
    expect(filesystem.move).toHaveBeenCalledWith('/downloads/track.mp3', '/build/assets/remote.mp3');
    expect(project.buildInfos.musicPath).toBe('/build/assets/remote.mp3');
  });

  // Regression guard: the schema documents `name` as the human-readable track name, but the name
  // used to flow verbatim into the staged filename, and `-i <path>` is space-split by parseCommand —
  // 'Epic Rise' produced '-i …/Epic Rise.mp3', two argv tokens, and the mix failed 'No such file'.
  it('slugs whitespace and quotes out of the staged filename derived from a display name', async () => {
    const project = makeProject({ music: { name: "Epic Rise's Theme", url: 'https://cdn.test/epic.mp3' } });
    const filesystem = makeFilesystem();
    filesystem.stat.mockResolvedValue(false);
    const { composer } = makeComposer({ project, filesystem });

    await composer.loadMusic();

    expect(filesystem.move).toHaveBeenCalledWith('/downloads/track.mp3', '/build/assets/Epic_Rise_s_Theme.mp3');
    expect(project.buildInfos.musicPath).toBe('/build/assets/Epic_Rise_s_Theme.mp3');
  });

  it('derives the music name from the URL when no name is provided', async () => {
    const project = makeProject({ music: { name: '', url: 'https://cdn.test/path/cool-track.mp3' } });
    const filesystem = makeFilesystem();
    filesystem.stat.mockResolvedValue(false);
    const { composer } = makeComposer({ project, filesystem });

    await composer.loadMusic();

    expect(project.buildInfos.musicPath).toBe('/build/assets/cool-track.mp3');
  });

  it('fetches a named track from the asset source (GitHub LFS raw) when not cached, bundled, or given a url', async () => {
    const project = makeProject({ music: { name: 'orphan' } });
    const filesystem = makeFilesystem();
    filesystem.stat.mockResolvedValue(false);
    const { composer } = makeComposer({ project, filesystem });

    await composer.loadMusic();

    // `github.com/<o>/<r>/raw/…` resolves Git-LFS objects to the real binary; `raw.githubusercontent`
    // would serve the LFS pointer text instead.
    expect(filesystem.fetch).toHaveBeenCalledWith(
      'https://github.com/heristop/leclap/raw/main/packages/leclap-creative-kit/src/library/musics/orphan.mp3'
    );
    expect(project.buildInfos.musicPath).toBe('/build/assets/orphan.mp3');
  });

  it('treats a relative music url as a name hint and fetches it by name from the asset source', async () => {
    // Catalog templates carry `{ name, url: 'musics/<file>.mp3' }` — the url is an assets-dir hint, not
    // a fetchable URL. When the file is not local, fetch by name from the canonical remote, never the
    // relative path (which would `realpath`-crash on the Node adapter).
    const project = makeProject({ music: { name: 'point-being', url: 'musics/point-being.mp3' } });
    const filesystem = makeFilesystem();
    filesystem.stat.mockResolvedValue(false);
    const { composer } = makeComposer({ project, filesystem });

    await composer.loadMusic();

    expect(filesystem.fetch).toHaveBeenCalledWith(
      'https://github.com/heristop/leclap/raw/main/packages/leclap-creative-kit/src/library/musics/point-being.mp3'
    );
    expect(filesystem.fetch).not.toHaveBeenCalledWith('musics/point-being.mp3');
  });

  it('uses a bundled track by name (no URL, no download) when one ships with the package', async () => {
    const project = makeProject({ music: { name: 'lofi-jazz-music.mp3' } });
    const filesystem = makeFilesystem();
    filesystem.stat.mockResolvedValue(false);
    filesystem.resolveBundledMusic.mockResolvedValue('/pkg/dist/musics/lofi-jazz-music.mp3');
    const { composer } = makeComposer({ project, filesystem });

    await composer.loadMusic();

    expect(filesystem.resolveBundledMusic).toHaveBeenCalledWith('lofi-jazz-music.mp3');
    expect(project.buildInfos.musicPath).toBe('/pkg/dist/musics/lofi-jazz-music.mp3');
    expect(filesystem.fetch).not.toHaveBeenCalled();
  });
});

describe('MusicComposer.prepareMusicTrack', () => {
  it('builds a fade-in filter for the first section', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 3;
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.5 } } });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4, musicVolume: 0.8 } });
    expect(project.buildInfos.currentIncrement).toBe(1);

    // A leg's own filter is only pushed once the transition into the NEXT section is known (see
    // finalizeLeg) — a second call flushes section 1.
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    expect(filters).toContain('afade=t=in:st=0:d=0.5');
    expect(filters).toContain('volume=0.8');
  });

  it('builds a middle-section filter plus a crossfade against the first section', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 3;
    project.buildInfos.currentIncrement = 1;
    const { composer } = makeComposer({ project });

    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });
    // section 2's own filter + its crossfade against section 1 are only pushed once section 3's
    // duration is known.
    composer.prepareMusicTrack({ name: 's3', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    // default volume level 0.5, no fade for a middle section
    expect(filters).toContain('volume=0.5[section2]');
    // crossfade between section1 and section2
    expect(filters).toContain('[section1][section2]acrossfade');
    expect(filters).toContain('[crossed1]');
  });

  it('builds a fade-out filter for the last section and a lastcrossed crossfade', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 3;
    project.buildInfos.currentIncrement = 2;
    const { composer } = makeComposer({ project });

    composer.prepareMusicTrack({ name: 's3', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    expect(filters).toContain('afade=t=out');
    expect(filters).toContain('[lastsection]');
    // previousMapName for increment 3 is crossed1, mapped to lastcrossed
    expect(filters).toContain('[crossed1][lastsection]acrossfade');
    expect(filters).toContain('[lastcrossed]');
  });
});

describe('MusicComposer.appendMusic', () => {
  const segments1: Section[] = [{ name: 's1', type: 'video', options: { duration: 4 } }];
  const segmentsMulti: Section[] = [
    { name: 's1', type: 'video', options: { duration: 4 } },
    { name: 's2', type: 'video', options: { duration: 4 } },
  ];

  it('builds a single-segment filter complex and mixes the music', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const template = makeTemplate({ global: { audio: { sourceVolume: 0.9 } } });
    const filesystem = makeFilesystem();
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, template, filesystem, ffmpeg });

    await composer.appendMusic(segments1, '/build/output.mp4');

    expect(filesystem.move).toHaveBeenCalled();
    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('volume=0.9');
    expect(cmd).toContain('sample_rates=48000');
    // single-segment path uses [1:a] directly (no musicFilters join)
    expect(cmd).toContain('[1:a]aformat');
    expect(cmd).toContain('amix=inputs=2:duration=first[final]');
    expect(filesystem.unlink).toHaveBeenCalled();
  });

  it('builds a multi-segment filter complex using the accumulated music filters', async () => {
    const project = makeProject();
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    project.buildInfos.musicFilters = [' [filterA];', ' [filterB];'];
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, ffmpeg });

    await composer.appendMusic(segmentsMulti, '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('[filterA]');
    expect(cmd).toContain('[lastcrossed]');
    // default audio volume level is 1 when not set
    expect(cmd).toContain('volume=1');
  });

  it('builds a music-only graph when the concat output has no audio stream', async () => {
    // A video-only upload yields an audio-less concat output. The filtergraph
    // must NOT reference [0:a] (which would abort: "matches no streams") and must
    // route the music straight to [final] instead of amix-ing with absent audio.
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: null, sampleRate: null })),
    };
    const { composer } = makeComposer({ project, ffmpeg });

    await composer.appendMusic(segments1, '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).not.toContain('[0:a]');
    expect(cmd).not.toContain('amix');
    expect(cmd).toContain('[1:a]');
    expect(cmd).toContain('[final]');
    // The output map is still video + the produced [final] audio.
    expect(cmd).toContain('-map 0:v -map "[final]"');
  });

  it('consumes the concat demuxer and stream-copies video when given a concat source', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const filesystem = makeFilesystem();
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, filesystem, ffmpeg });

    await composer.appendMusic(segments1, '/build/output.mp4', { kind: 'concat', listPath: '/build/segments.list' });

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('-f concat -safe 0 -auto_convert 1 -i /build/segments.list');
    expect(cmd).toContain('-c:v copy');
    expect(cmd).toContain('-map 0:v -map "[final]"');
    expect(cmd).toContain('+faststart -shortest /build/output.mp4');
    // probed the first listed segment for audio, not the not-yet-existing final output
    expect(ffmpeg.getInfos).toHaveBeenCalledWith('/build/intro_output.mp4');
    // folded path never moves the final output aside
    expect(filesystem.move).not.toHaveBeenCalled();
    expect(filesystem.unlink).not.toHaveBeenCalled();
  });

  it('still moves and reads a file source by default (unchanged behavior)', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const filesystem = makeFilesystem();
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, filesystem, ffmpeg });

    await composer.appendMusic(segments1, '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('-i /tmp/tmp_video_');
    expect(cmd).not.toContain('-f concat');
    expect(filesystem.move).toHaveBeenCalled();
    expect(filesystem.unlink).toHaveBeenCalled();
  });

  it('throws when the music mixing ffmpeg command fails (rc 1)', async () => {
    const project = makeProject();
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const ffmpeg = {
      execute: vi.fn(async () => ({ rc: 1 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const filesystem = makeFilesystem();
    const { composer } = makeComposer({ project, ffmpeg, filesystem });

    await expect(composer.appendMusic(segments1, '/build/output.mp4')).rejects.toThrow('Error on music add');
    // temp file is not unlinked when the command failed
    expect(filesystem.unlink).not.toHaveBeenCalled();
  });

  // The mix command is a space-split string; a musicPath with raw whitespace (e.g. a bundled file
  // that bypassed the loadMusic slug) must fail loudly at the guard, never mis-tokenize into
  // '-i …/Epic' plus a stray 'Rise.mp3' argument.
  it('rejects a music path containing whitespace instead of splitting the command', async () => {
    const project = makeProject();
    project.buildInfos.musicPath = '/cache/musics/Epic Rise.mp3';
    const ffmpeg = {
      execute: vi.fn(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const filesystem = makeFilesystem();
    const { composer } = makeComposer({ project, ffmpeg, filesystem });

    await expect(composer.appendMusic(segments1, '/build/output.mp4')).rejects.toThrow('Unsafe music path');
    // fails fast: the final video is never moved aside and no ffmpeg process runs
    expect(filesystem.move).not.toHaveBeenCalled();
    expect(ffmpeg.execute).not.toHaveBeenCalled();
  });
});

describe('MusicComposer.normalizeAudio / hasNormalization', () => {
  it('normalizes audio off a concat source while stream-copying video (no move)', async () => {
    const project = makeProject();
    const template = makeTemplate({ global: { audio: { normalize: 'loudnorm' } } });
    const filesystem = makeFilesystem();
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, template, filesystem, ffmpeg });

    await composer.normalizeAudio('/build/output.mp4', { kind: 'concat', listPath: '/build/segments.list' });

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('-f concat -safe 0 -auto_convert 1 -i /build/segments.list');
    expect(cmd).toContain('-af "loudnorm=I=-16:TP=-1.5:LRA=11"');
    expect(cmd).toContain('-c:v copy');
    expect(cmd).toContain('+faststart /build/output.mp4');
    expect(filesystem.move).not.toHaveBeenCalled();
  });

  it('aims loudnorm at the delivery platform loudness when global.platform is set', async () => {
    const template = makeTemplate({ global: { platform: 'tiktok', audio: { normalize: 'loudnorm' } } });
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ template, ffmpeg });

    await composer.normalizeAudio('/build/output.mp4', { kind: 'concat', listPath: '/build/segments.list' });

    expect(ffmpeg.execute.mock.calls[0][0]).toContain('-af "loudnorm=I=-14:TP=-1:LRA=11"');
  });

  it('moves and reads a file source by default (unchanged behavior)', async () => {
    const project = makeProject();
    const template = makeTemplate({ global: { audio: { normalize: 'dynaudnorm' } } });
    const filesystem = makeFilesystem();
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, template, filesystem, ffmpeg });

    await composer.normalizeAudio('/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('-i /tmp/tmp_normalize_');
    expect(cmd).not.toContain('-f concat');
    expect(filesystem.move).toHaveBeenCalled();
    expect(filesystem.unlink).toHaveBeenCalled();
  });

  it('is a no-op when no normalization is configured', async () => {
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ ffmpeg });

    await composer.normalizeAudio('/build/output.mp4', { kind: 'concat', listPath: '/build/segments.list' });

    expect(ffmpeg.execute).not.toHaveBeenCalled();
  });

  it('hasNormalization reflects the descriptor', () => {
    expect(
      makeComposer({
        template: makeTemplate({ global: { audio: { normalize: 'loudnorm' } } }),
      }).composer.hasNormalization()
    ).toBe(true);
    expect(makeComposer({}).composer.hasNormalization()).toBe(false);
  });
});

describe('MusicComposer.loopMusic', () => {
  it('delegates to the music adapter with total length and music path', async () => {
    const project = makeProject();
    project.buildInfos.totalLength = 42;
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const { composer, filesystem, logger } = makeComposer({ project });

    await composer.loopMusic();

    expect(musicAdapter.process).toHaveBeenCalledWith(logger, filesystem, 42, '/cache/musics/song.mp3');
  });

  it('mixes the looped copy the adapter returns, not the source track it was handed', async () => {
    const project = makeProject();
    project.buildInfos.totalLength = 42;
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 42, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, ffmpeg });
    musicAdapter.process.mockResolvedValueOnce({ rc: 0, musicPath: '/build/loop_music.mp4' });

    await composer.loopMusic();
    await composer.appendMusic([{ name: 's1', type: 'video', options: { duration: 42 } }], '/build/output.mp4');

    expect(project.buildInfos.musicPath).toBe('/build/loop_music.mp4');
    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('-i /build/loop_music.mp4');
    expect(cmd).not.toContain('/cache/musics/song.mp3');
  });
});

describe('MusicComposer.prepareMusicTrack — source-contiguous windows', () => {
  it('shifts the next window early by the boundary overlap, shrinking the PRIOR leg to match (video-timeline aligned, still source-contiguous)', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    // Boundary 0 (after section 1) is a wipeleft transition of duration 0.5 — this overlaps 0.5s of
    // VIDEO between the two clips, so the video timeline is only 4 + 4 - 0.5 = 7.5s long.
    project.buildInfos.transitions = [{ type: 'wipeleft', duration: 0.5 }];
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.3 } } });
    const { composer } = makeComposer({ project, template });

    // Section 1 (first): duration 4
    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4 } });
    // Section 2 (last): duration 4
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    // Section 1's advance is shrunk by the same 0.5s the video overlap consumes (4 - 0.5 = 3.5), so
    // its window is shortened to match: t = 3.5 + 0.3 = 3.8, covering source [0, 3.8].
    expect(filters).toContain('atrim=start=0:duration=3.8');
    // Section 2 starts at 3.5 (section 1's advance), matching the video's own compressed timeline —
    // NOT at the full, uncompressed 4. Section 1's tail (its last 0.3s, source [3.5, 3.8]) is
    // IDENTICAL to section 2's head (its first 0.3s, source [3.5, 3.8]) because both derive from the
    // same shrunk advance, so the d=0.3 acrossfade still blends one continuous copy of the song, not
    // two offset copies (the doubled/echo failure mode this must avoid).
    expect(filters).toContain('atrim=start=3.5:duration=4.3');
  });

  it('cut transition does not shift the window (no video overlap)', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    project.buildInfos.transitions = [{ type: 'cut', duration: 0.5 }];
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.3 } } });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    // A cut has zero video overlap (buildInfos.transitions stores duration:0 for it upstream) — no
    // shift: section 2 starts at 4 (full duration of section 1)
    expect(filters).toContain('atrim=start=4:duration=4.3');
  });

  it('missing transition entry is treated as cut (no shift)', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    // Empty transitions array — defensive against missing entry.
    project.buildInfos.transitions = [];
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.3 } } });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 5 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 3 } });

    const filters = project.buildInfos.musicFilters.join('');
    expect(filters).toContain('atrim=start=5:duration=3.3');
  });

  it('keeps adjacent acrossfade legs source-contiguous across three sections with mixed transitions (no doubled echo)', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 3;
    // Every boundary is a non-cut transition; each leg's advance shrinks by its OWN boundary's
    // overlap, and the music windows still stay contiguous in source time so each acrossfade splices
    // identical audio.
    project.buildInfos.transitions = [
      { type: 'fade', duration: 0.5 },
      { type: 'wipeleft', duration: 0.7 },
    ];
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.3 } } });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 6 } });
    composer.prepareMusicTrack({ name: 's3', type: 'video', options: { duration: 5 } });

    const filters = project.buildInfos.musicFilters.join('');
    // advance1 = 4 - 0.5 = 3.5; advance2 = 6 - 0.7 = 5.3; advance3 = 5 (last, no boundary after it).
    // Each window starts at the cumulative advance of the prior legs (0, 3.5, 8.8) and runs for
    // advance + the global transition fade (0.3). Leg N's tail therefore equals leg N+1's head.
    expect(filters).toContain('atrim=start=0:duration=3.8'); // leg1 source [0, 3.8]
    expect(filters).toContain('atrim=start=3.5:duration=5.6'); // leg2 source [3.5, 9.1] — head == leg1 tail
    expect(filters).toContain('atrim=start=8.8:duration=5.3'); // leg3 source [8.8, 14.1] — head == leg2 tail
  });

  it('cumulative music timeline equals the video timeline for a multi-section template with mixed per-section transition durations', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 4;
    // Mixed transitions: a longer intro fade, a cut (no overlap), and a short wipe.
    project.buildInfos.transitions = [
      { type: 'fade', duration: 0.4 },
      { type: 'cut', duration: 0 },
      { type: 'wipeleft', duration: 0.2 },
    ];
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.2 } } });
    const { composer } = makeComposer({ project, template });

    const durations = [3.5, 2.8, 12, 4];

    for (const [i, duration] of durations.entries()) {
      composer.prepareMusicTrack({ name: `s${i + 1}`, type: 'video', options: { duration } });
    }

    // Video timeline length = sum(durations) - sum(effective per-boundary overlaps). None of these
    // transitions get capped (all well under half of their adjacent sections), so the effective
    // overlap is the declared duration, except the cut (0 overlap): 0.4 + 0 + 0.2 = 0.6.
    const videoTimelineLength = durations.reduce((a, b) => a + b, 0) - 0.6;
    expect(project.buildInfos.currentLength).toBeCloseTo(videoTimelineLength, 5);
  });
});

describe('MusicComposer.prepareMusicTrack — musicFade decoupling', () => {
  it('defaults to the transition duration for both the atrim tail and the acrossfade when musicFade is unset', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.2 } } });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    expect(filters).toContain('atrim=start=0:duration=4.2');
    expect(filters).toContain('acrossfade=d=0.2');
  });

  it('uses global.audio.musicFade for both the atrim tail and the acrossfade when set', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    const template = makeTemplate({
      global: { transition: { type: 'fade', duration: 0.2 }, audio: { musicFade: 1 } },
    });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    // Tail and acrossfade both use the configured 1s fade, not the 0.2s video transition.
    expect(filters).toContain('atrim=start=0:duration=5');
    expect(filters).toContain('acrossfade=d=1');
    // The video transition duration is left untouched for the fade-in/out of the outer sections.
    expect(project.buildInfos.totalSegments).toBe(2);
  });

  it('clamps musicFade to half the shortest renderable section when a section is shorter than 2x the requested fade', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    const template = makeTemplate({
      global: { transition: { type: 'fade', duration: 0.2 }, audio: { musicFade: 1 } },
      sections: [
        { name: 's1', type: 'video', options: { duration: 4 } },
        { name: 's2', type: 'video', options: { duration: 1 } },
      ],
    });
    const { composer } = makeComposer({ project, template });

    // Shortest renderable section is 1s, so the fade is capped at 0.5 (half of 1), below the
    // requested 1s.
    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 1 } });

    const filters = project.buildInfos.musicFilters.join('');
    expect(filters).toContain('atrim=start=0:duration=4.5');
    expect(filters).toContain('acrossfade=d=0.5');
  });

  it('never clamps below the 0.05s floor', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    const template = makeTemplate({
      global: { transition: { type: 'fade', duration: 0.2 }, audio: { musicFade: 1 } },
      sections: [
        { name: 's1', type: 'video', options: { duration: 0.06 } },
        { name: 's2', type: 'video', options: { duration: 0.06 } },
      ],
    });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 0.06 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 0.06 } });

    const filters = project.buildInfos.musicFilters.join('');
    expect(filters).toContain('acrossfade=d=0.05');
  });

  it('ignores non-renderable sections (e.g. form) and zero-duration sections when computing the cap', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    const template = makeTemplate({
      global: { transition: { type: 'fade', duration: 0.2 }, audio: { musicFade: 1 } },
      sections: [
        { name: 'form_1', type: 'form', options: {} },
        { name: 's1', type: 'video', options: { duration: 4 } },
        { name: 's2', type: 'video', options: { duration: 4 } },
      ],
    });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    // Cap is half of 4 (the only renderable durations), not skewed by the durationless form section.
    expect(filters).toContain('atrim=start=0:duration=5');
    expect(filters).toContain('acrossfade=d=1');
  });

  it('keeps the tail and acrossfade duration equal across the whole build (source-contiguous invariant)', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 3;
    project.buildInfos.transitions = [
      { type: 'fade', duration: 0.5 },
      { type: 'wipeleft', duration: 0.7 },
    ];
    const template = makeTemplate({
      global: { transition: { type: 'fade', duration: 0.3 }, audio: { musicFade: 0.8 } },
    });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 6 } });
    composer.prepareMusicTrack({ name: 's3', type: 'video', options: { duration: 5 } });

    const filters = project.buildInfos.musicFilters.join('');
    // advance1 = 4 - 0.5 = 3.5 (t = 3.5 + 0.8 = 4.3); advance2 = 6 - 0.7 = 5.3 (t = 5.3 + 0.8 = 6.1);
    // advance3 = 5 (last section, t = 5 + 0.8 = 5.8). musicFade (0.8) is unaffected by the boundary
    // overlaps — only the video-timeline advance is.
    expect(filters).toContain('atrim=start=0:duration=4.3');
    expect(filters).toContain('atrim=start=3.5:duration=6.1');
    expect(filters).toContain('atrim=start=8.8:duration=5.8');
    expect(filters.match(/acrossfade=d=0\.8/g)).toHaveLength(2);
  });
});

describe('MusicComposer.prepareMusicTrack — rendered (declared-vs-probed) duration', () => {
  // A project_video section's RENDERED length is min(declared, probed): ProjectVideoSegment trims
  // with `-t options.duration -shortest`, so a shorter recorded/uploaded clip caps the segment below
  // the declared duration. buildInfos.durations holds the RAW probed clip length for a project_video
  // (calculateTotalLength / getVideoSectionDuration) — the leg advance must use whichever of
  // declared/probed is SMALLER, not the declared value alone, or the music window drifts past where
  // the section actually ends on the real video timeline.
  it('uses the shorter PROBED clip length (not the declared duration) as the leg duration when the recorded clip is short', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    // Declared 12s, but the actual uploaded clip only probed to 6s — the rendered segment is 6s.
    project.buildInfos.durations = { s1: 6 };
    project.buildInfos.transitions = [{ type: 'fade', duration: 0.2 }];
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.2 } } });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'project_video', options: { duration: 12 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    // advance1 = round(6 - 0.2) = 5.8 (using the PROBED 6s, not the declared 12s); t = 5.8 + 0.2 = 6.
    expect(filters).toContain('atrim=start=0:duration=6,');
    // s2 is the last section, so calling prepareMusicTrack for it finalizes BOTH legs: final
    // currentLength = advance1 (5.8) + s2's own full-duration advance (4, last section) = 9.8.
    expect(project.buildInfos.currentLength).toBeCloseTo(9.8, 5);
  });

  it('uses the shorter DECLARED duration (not the longer probed clip) when the recorded clip overshoots', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    // Declared 12s, but the probed clip is actually 15s long — the segment is still trimmed to 12s.
    project.buildInfos.durations = { s1: 15 };
    project.buildInfos.transitions = [{ type: 'fade', duration: 0.2 }];
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.2 } } });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'project_video', options: { duration: 12 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    // advance1 = round(12 - 0.2) = 11.8 (capped at the declared 12s, not the longer 15s probe).
    expect(filters).toContain('atrim=start=0:duration=12,');
    // s2 is the last section: final currentLength = advance1 (11.8) + s2's own full duration (4) = 15.8.
    expect(project.buildInfos.currentLength).toBeCloseTo(15.8, 5);
  });

  it('falls back to whichever of declared/probed is set when the other is 0/missing', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    // No probed entry at all (e.g. a non-project_video section, or a build that hasn't populated
    // durations yet) — falls back to the declared duration.
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.2 } } });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 5 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    expect(filters).toContain('atrim=start=0:duration=5');
  });

  // The music-fade CAP (maxMusicFadeFromSections, via resolveMusicFade) must ALSO use the rendered
  // (capped) duration, not the declared one — otherwise a musicFade could still be sized against a
  // section's declared length even though it renders much shorter.
  it('caps musicFade against the RENDERED duration of a trimmed project_video section, not its declared length', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    // Declared 12s but probed/rendered to 1s — half of the rendered length (0.5) is a tighter cap
    // than half of the declared length (6) would have been.
    project.buildInfos.durations = { s1: 1 };
    const template = makeTemplate({
      global: { transition: { type: 'fade', duration: 0.2 }, audio: { musicFade: 2 } },
      sections: [
        { name: 's1', type: 'project_video', options: { duration: 12 } },
        { name: 's2', type: 'video', options: { duration: 4 } },
      ],
    });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'project_video', options: { duration: 12 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    expect(filters).toContain('acrossfade=d=0.5');
  });
});

describe('MusicComposer.appendMusic — -shortest bound', () => {
  it('bounds the muxed output to the video stream length so a long music tail never extends it', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, ffmpeg });

    await composer.appendMusic([{ name: 's1', type: 'video', options: { duration: 4 } }], '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('-shortest');
  });

  it('bounds the muxed output to the video stream length on the video-only (no source audio) graph too', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: null, sampleRate: null })),
    };
    const { composer } = makeComposer({ project, ffmpeg });

    await composer.appendMusic([{ name: 's1', type: 'video', options: { duration: 4 } }], '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('-shortest');
  });
});

describe('MusicComposer.prepareMusicTrack — last-section afade st clamp', () => {
  it('clamps a negative afade-out st to 0 when the last section is shorter than the transition duration', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 2;
    const template = makeTemplate({ global: { transition: { type: 'fade', duration: 0.5 } } });
    const { composer } = makeComposer({ project, template });

    // A non-first, LAST section shorter (0.3s) than the video transition duration (0.5s) — the naive
    // `duration - transitionDuration` would be negative (-0.2), an invalid ffmpeg afade `st`.
    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 0.3 } });

    const filters = project.buildInfos.musicFilters.join('');
    expect(filters).toContain('afade=t=out:st=0:d=0.5');
    expect(filters).not.toContain('st=-0.2');
  });
});

describe('MusicComposer.prepareMusicTrack — clean (rounded) atrim args', () => {
  it('rounds the atrim window (t) and the leg-boundary ss so emitted filter args never carry raw float noise', () => {
    const project = makeProject();
    project.buildInfos.totalSegments = 3;
    project.buildInfos.transitions = [
      { type: 'fade', duration: 0.3 },
      { type: 'fade', duration: 0.3 },
    ];
    const template = makeTemplate({
      global: { transition: { type: 'fade', duration: 0.3 }, audio: { musicFade: 0.1 } },
    });
    const { composer } = makeComposer({ project, template });

    composer.prepareMusicTrack({ name: 's1', type: 'video', options: { duration: 4.4 } });
    composer.prepareMusicTrack({ name: 's2', type: 'video', options: { duration: 3.6 } });
    composer.prepareMusicTrack({ name: 's3', type: 'video', options: { duration: 4 } });

    const filters = project.buildInfos.musicFilters.join('');
    // advance1 = round(4.4 - 0.3) = 4.1; raw t1 = 4.1 + 0.1 = 4.199999999999999 without rounding.
    expect(filters).toContain('atrim=start=0:duration=4.2');
    // advance2 = round(3.6 - 0.3) = 3.3; raw nextCurrentLength = 4.1 + 3.3 = 7.3999999999999995.
    expect(filters).toContain('atrim=start=4.1:duration=3.4');
    expect(filters).toContain('atrim=start=7.4:duration=4.1');
    // s3 is the LAST section (no outgoing boundary): its own advance is its full duration (4), so the
    // final currentLength is round(7.4 + 4) = 11.4, not the intermediate 7.4 (already asserted above
    // via the leg3 atrim start).
    expect(project.buildInfos.currentLength).toBeCloseTo(11.4, 5);

    for (const noisy of ['4.199999999999999', '7.3999999999999995', '3.3999999999999995']) {
      expect(filters).not.toContain(noisy);
    }
  });
});

describe('MusicComposer.appendMusic — normalize', () => {
  const segments1: Section[] = [{ name: 's1', type: 'video', options: { duration: 4 } }];

  it('appends loudnorm filter after the final mix when normalize is loudnorm', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const template = makeTemplate({ global: { audio: { normalize: 'loudnorm' } } });
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, template, ffmpeg });

    await composer.appendMusic(segments1, '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    // The normalize filter must sit INSIDE the chain, before the [final] label —
    // a labeled output ends an ffmpeg chain, so `[final],loudnorm` is invalid graph syntax.
    expect(cmd).toContain('loudnorm=I=-16:TP=-1.5:LRA=11[final]');
  });

  it('appends dynaudnorm filter after the final mix when normalize is dynaudnorm', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const template = makeTemplate({ global: { audio: { normalize: 'dynaudnorm' } } });
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, template, ffmpeg });

    await composer.appendMusic(segments1, '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('dynaudnorm=f=150:g=15[final]');
  });

  it('does not modify graph when no normalize is configured', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const template = makeTemplate({ global: { audio: { sourceVolume: 1 } } });
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, template, ffmpeg });

    await composer.appendMusic(segments1, '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).not.toContain('loudnorm');
    expect(cmd).not.toContain('dynaudnorm');
    expect(cmd).toContain('amix=inputs=2:duration=first[final]');
  });
});

describe('MusicComposer.appendMusic — ducking', () => {
  const segments1: Section[] = [{ name: 's1', type: 'video', options: { duration: 4 } }];

  it('inserts sidechaincompress with defaults when ducking is true', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const template = makeTemplate({ global: { audio: { ducking: true } } });
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, template, ffmpeg });

    await composer.appendMusic(segments1, '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400');
    expect(cmd).toContain('asplit=2');
    expect(cmd).toContain('amix=inputs=2:duration=first:normalize=0');
  });

  it('uses object ducking values when provided', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const template = makeTemplate({ global: { audio: { ducking: { threshold: 0.1, ratio: 4 } } } });
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, template, ffmpeg });

    await composer.appendMusic(segments1, '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('sidechaincompress=threshold=0.1:ratio=4:attack=20:release=400');
  });

  it('does not insert ducking when no ducking config is set (regression)', async () => {
    const project = makeProject({ audioConfig: { sampleRate: 48000 } });
    project.buildInfos.musicPath = '/cache/musics/song.mp3';
    const template = makeTemplate({});
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ project, template, ffmpeg });

    await composer.appendMusic(segments1, '/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).not.toContain('sidechaincompress');
    expect(cmd).not.toContain('asplit');
    // The non-ducking path keeps the original plain amix (no normalize=0)
    expect(cmd).toContain('amix=inputs=2:duration=first[final]');
    expect(cmd).not.toContain('normalize=0');
  });
});

describe('MusicComposer.normalizeAudio — no-music path', () => {
  it('runs a loudnorm filter command and replaces the output file', async () => {
    const template = makeTemplate({ global: { audio: { normalize: 'loudnorm' } } });
    const filesystem = makeFilesystem();
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ template, filesystem, ffmpeg });

    await composer.normalizeAudio('/build/output.mp4');

    expect(filesystem.move).toHaveBeenCalled();
    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    expect(cmd).toContain('-c:v copy');
    expect(filesystem.unlink).toHaveBeenCalled();
  });

  it('runs a dynaudnorm filter command when normalize is dynaudnorm', async () => {
    const template = makeTemplate({ global: { audio: { normalize: 'dynaudnorm' } } });
    const filesystem = makeFilesystem();
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ template, filesystem, ffmpeg });

    await composer.normalizeAudio('/build/output.mp4');

    const cmd = ffmpeg.execute.mock.calls[0][0];
    expect(cmd).toContain('dynaudnorm=f=150:g=15');
  });

  it('is a no-op when no normalize is configured', async () => {
    const template = makeTemplate({});
    const filesystem = makeFilesystem();
    const ffmpeg = {
      execute: vi.fn<(cmd: string) => Promise<{ rc: number }>>(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ template, filesystem, ffmpeg });

    await composer.normalizeAudio('/build/output.mp4');

    expect(filesystem.move).not.toHaveBeenCalled();
    expect(ffmpeg.execute).not.toHaveBeenCalled();
  });

  it('throws when the ffmpeg normalize command fails (rc 1)', async () => {
    const template = makeTemplate({ global: { audio: { normalize: 'loudnorm' } } });
    const filesystem = makeFilesystem();
    const ffmpeg = {
      execute: vi.fn(async () => ({ rc: 1 })),
      getInfos: vi.fn(async () => ({ duration: 10, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 })),
    };
    const { composer } = makeComposer({ template, filesystem, ffmpeg });

    await expect(composer.normalizeAudio('/build/output.mp4')).rejects.toThrow('Error on audio normalization');
    expect(filesystem.unlink).not.toHaveBeenCalled();
  });
});
