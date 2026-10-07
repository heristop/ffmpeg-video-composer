import 'reflect-metadata';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import VideoEditor from '@/editor/VideoEditor';
import type { Section, TemplateDescriptor } from '@/core/types';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeProject() {
  return {
    finalVideo: '',
    output: { staging: '', final: '' },
    ffmpegVersion: null,
    errors: [] as string[],
    buildInfos: {
      fileConcatPath: '/build/segments.list',
      musicPath: '',
      transitions: [] as Array<{ type: string; duration: number }>,
    },
    clean: vi.fn(),
  };
}

function makeTemplate(descriptor: TemplateDescriptor = {}) {
  return { descriptor, assets: { fonts: {}, musics: {}, inputs: [] }, clean: vi.fn() };
}

function makeFilesystem() {
  return {
    getBuildDir: vi.fn((): string | undefined => '/build'),
    read: vi.fn(async () => ''),
    copy: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
  };
}

function makeEditor(
  opts: {
    project?: ReturnType<typeof makeProject>;
    template?: ReturnType<typeof makeTemplate>;
    filesystem?: ReturnType<typeof makeFilesystem>;
    ffmpeg?: { execute: ReturnType<typeof vi.fn> };
    musicComposer?: { loopMusic: ReturnType<typeof vi.fn>; appendMusic: ReturnType<typeof vi.fn> };
  } = {}
) {
  const project = opts.project ?? makeProject();
  const template = opts.template ?? makeTemplate();
  const filesystem = opts.filesystem ?? makeFilesystem();
  const ffmpeg = opts.ffmpeg ?? { execute: vi.fn(async () => ({ rc: 0 })) };
  const musicComposer = opts.musicComposer ?? {
    loopMusic: vi.fn(async () => undefined),
    appendMusic: vi.fn(async () => undefined),
  };
  const animationComposer = { appendAnimations: vi.fn(async () => undefined) };
  const logger = makeLogger();
  const emitter = { on: vi.fn(), emit: vi.fn(() => true) };

  const editor = new VideoEditor(
    project as never,
    template as never,
    musicComposer as never,
    animationComposer as never,
    logger as never,
    ffmpeg as never,
    filesystem as never
  );
  editor.emitter = emitter as never;

  return { editor, project, template, filesystem, ffmpeg, musicComposer, logger, emitter };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VideoEditor.concat', () => {
  it('throws when the concat file path is not defined', async () => {
    const project = makeProject();
    project.buildInfos.fileConcatPath = '';
    const { editor, logger } = makeEditor({ project });

    await expect(editor.concat()).rejects.toThrow('Concat file path is not defined');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Concat file path is not defined'));
  });

  it('throws when the segments list is empty', async () => {
    const filesystem = makeFilesystem();
    filesystem.read.mockResolvedValue('\n\n');
    const { editor } = makeEditor({ filesystem });

    await expect(editor.concat()).rejects.toThrow('No files to concat in the segments list');
  });

  it('remuxes the single file with +faststart when only one segment exists', async () => {
    const filesystem = makeFilesystem();
    filesystem.read.mockResolvedValue("file '/build/clip_output.mp4'\n");
    const { editor, ffmpeg, project } = makeEditor({ filesystem });

    const result = await editor.concat();

    expect(result).toBe('/build/output.mp4');
    expect(project.finalVideo).toBe('/build/output.mp4');
    // Stream-copy remux moves the moov atom to the front so the output previews in a browser.
    expect(ffmpeg.execute).toHaveBeenCalledWith(
      expect.stringContaining('-i /build/clip_output.mp4 -c copy -movflags +faststart /build/output.mp4')
    );
    // No re-encode concat, and no raw byte copy on the happy path.
    expect(ffmpeg.execute).not.toHaveBeenCalledWith(expect.stringContaining('-f concat'));
    expect(filesystem.copy).not.toHaveBeenCalled();
  });

  it('falls back to a byte copy when the single-file faststart remux fails (rc 1)', async () => {
    const filesystem = makeFilesystem();
    filesystem.read.mockResolvedValue("file '/build/clip_output.mp4'\n");
    const ffmpeg = { execute: vi.fn(async () => ({ rc: 1 })) };
    const { editor, project } = makeEditor({ filesystem, ffmpeg });

    const result = await editor.concat();

    expect(result).toBe('/build/output.mp4');
    expect(project.finalVideo).toBe('/build/output.mp4');
    expect(filesystem.copy).toHaveBeenCalledWith('/build/clip_output.mp4', '/build/output.mp4');
  });

  it('falls back to a byte copy when the remux adapter throws (Node exits non-zero)', async () => {
    const filesystem = makeFilesystem();
    filesystem.read.mockResolvedValue("file '/build/clip_output.mp4'\n");
    const ffmpeg = {
      execute: vi.fn(async () => {
        throw new Error('FFmpeg command failed');
      }),
    };
    const { editor, project } = makeEditor({ filesystem, ffmpeg });

    const result = await editor.concat();

    expect(result).toBe('/build/output.mp4');
    expect(project.finalVideo).toBe('/build/output.mp4');
    expect(filesystem.copy).toHaveBeenCalledWith('/build/clip_output.mp4', '/build/output.mp4');
  });

  it('runs the ffmpeg concat command for multiple files (success)', async () => {
    const filesystem = makeFilesystem();
    filesystem.read.mockResolvedValue('file /build/a.mp4\nfile /build/b.mp4\n');
    const ffmpeg = { execute: vi.fn(async () => ({ rc: 0 })) };
    const { editor } = makeEditor({ filesystem, ffmpeg });

    const result = await editor.concat();

    expect(result).toBe('/build/output.mp4');
    expect(ffmpeg.execute).toHaveBeenCalledWith(expect.stringContaining('-f concat -safe 0 -auto_convert 1'));
  });

  it('throws and records an error when the ffmpeg concat fails (rc 1)', async () => {
    const filesystem = makeFilesystem();
    filesystem.read.mockResolvedValue('file /build/a.mp4\nfile /build/b.mp4\n');
    const ffmpeg = { execute: vi.fn(async () => ({ rc: 1 })) };
    const { editor, project } = makeEditor({ filesystem, ffmpeg });

    await expect(editor.concat()).rejects.toThrow('[Concat] Errors on concatenation');
    expect(project.errors).toContain('concat');
  });

  it('falls back to the default build dir when getBuildDir returns undefined', async () => {
    const filesystem = makeFilesystem();
    filesystem.getBuildDir.mockReturnValue(undefined);
    filesystem.read.mockResolvedValue("file '/x/clip.mp4'\n");
    const { editor, project } = makeEditor({ filesystem });

    await editor.concat();

    expect(project.finalVideo).toBe('build/output.mp4');
  });

  it('logs the message and rethrows when an Error is thrown during concat', async () => {
    const filesystem = makeFilesystem();
    // read rejects with a real Error -> caught at the concat catch (line 83, Error side)
    filesystem.read.mockRejectedValue(new Error('read failed'));
    const { editor, logger } = makeEditor({ filesystem });

    await expect(editor.concat()).rejects.toThrow('read failed');
    expect(logger.error).toHaveBeenCalledWith('[Concat] Error: read failed');
  });

  it("logs 'Unknown error' and rethrows when a non-Error is thrown during concat", async () => {
    const filesystem = makeFilesystem();
    // read rejects with a NON-Error value -> ternary false side (line 83) -> 'Unknown error'
    const nonError: unknown = 'plain string failure';
    filesystem.read.mockRejectedValue(nonError);
    const { editor, logger } = makeEditor({ filesystem });

    await expect(editor.concat()).rejects.toBe('plain string failure');
    expect(logger.error).toHaveBeenCalledWith('[Concat] Error: Unknown error');
  });
});

describe('VideoEditor.finalize', () => {
  const segments: Section[] = [{ name: 'clip', type: 'video', options: { duration: 4 } }];

  it('mixes music, emits finalize, cleans up and resets state when music is enabled and no errors', async () => {
    const template = makeTemplate({ global: { musicEnabled: true } });
    const project = makeProject();
    project.finalVideo = '/build/output.mp4';
    project.buildInfos.musicPath = '/build/music.mp3'; // a resolved track → music block runs
    const { editor, musicComposer, emitter, filesystem } = makeEditor({ template, project });

    await editor.finalize(segments);

    expect(musicComposer.loopMusic).toHaveBeenCalled();
    // finalize forwards an optional video source to appendMusic; undefined here (non-folded path).
    expect(musicComposer.appendMusic).toHaveBeenCalledWith(segments, '/build/output.mp4', undefined);
    expect(emitter.emit).toHaveBeenCalledWith('finalize', {
      video_source: '/build/output.mp4',
      template_assets: template.assets,
    });
    expect(filesystem.unlink).toHaveBeenCalledWith('/build/segments.list');
    expect(emitter.emit).toHaveBeenCalledWith('compilation-progress', 1);
    expect(project.clean).toHaveBeenCalled();
    expect(template.clean).toHaveBeenCalled();
  });

  it('does not mix music when musicEnabled is false', async () => {
    const template = makeTemplate({ global: { musicEnabled: false } });
    const { editor, musicComposer, emitter } = makeEditor({ template });

    await editor.finalize(segments);

    expect(musicComposer.loopMusic).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith('finalize', expect.any(Object));
  });

  it('skips finalize emission and cleanup when the project has errors', async () => {
    const project = makeProject();
    project.errors.push('clipA');
    const { editor, emitter, filesystem, project: p } = makeEditor({ project });

    await editor.finalize(segments);

    expect(emitter.emit).not.toHaveBeenCalledWith('finalize', expect.anything());
    expect(filesystem.unlink).not.toHaveBeenCalled();
    expect(p.clean).not.toHaveBeenCalled();
  });

  it('logs a warning when the segments file cannot be deleted', async () => {
    const filesystem = makeFilesystem();
    filesystem.unlink.mockRejectedValue(new Error('EPERM'));
    const { editor, logger } = makeEditor({ filesystem });

    await editor.finalize(segments);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not delete segments file: EPERM'));
  });

  it('skips the unlink entirely when no concat file path is set', async () => {
    const project = makeProject();
    project.buildInfos.fileConcatPath = ''; // falsy -> cleanupConcatFile `if (concatFilePath)` false side
    const { editor, filesystem } = makeEditor({ project });

    await editor.finalize(segments);

    expect(filesystem.unlink).not.toHaveBeenCalled();
  });

  it("warns with 'Unknown error' when unlink rejects with a non-Error", async () => {
    const filesystem = makeFilesystem();
    // unlink rejects with a non-Error -> cleanupConcatFile ternary false side (line 97)
    const nonError: unknown = 'not-an-error';
    filesystem.unlink.mockRejectedValue(nonError);
    const { editor, logger } = makeEditor({ filesystem });

    await editor.finalize(segments);

    expect(logger.warn).toHaveBeenCalledWith('Could not delete segments file: Unknown error');
  });

  // Regression guard: finalize used to log-and-swallow, so a failed music/animation pass let
  // compile() resolve a path to an output.mp4 the pass never wrote (in the folded path, that pass
  // IS what writes the final file). It must log, record the error, and rethrow so compile() fails.
  it('logs, records and rethrows errors thrown during finalize', async () => {
    const template = makeTemplate({ global: { musicEnabled: true } });
    const project = makeProject();
    project.finalVideo = '/build/output.mp4';
    project.buildInfos.musicPath = '/build/music.mp3'; // a resolved track → music block runs
    const musicComposer = {
      loopMusic: vi.fn(async () => {
        throw new Error('loop boom');
      }),
      appendMusic: vi.fn(async () => undefined),
    };
    const { editor, logger } = makeEditor({ template, project, musicComposer });

    await expect(editor.finalize(segments)).rejects.toThrow('loop boom');

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[Finalize] Error: loop boom'));
    expect(project.errors).toContain('finalize');
  });

  it("rethrows a non-Error thrown during finalize and logs 'Unknown error'", async () => {
    const template = makeTemplate({ global: { musicEnabled: true } });
    const project = makeProject();
    project.finalVideo = '/build/output.mp4';
    project.buildInfos.musicPath = '/build/music.mp3'; // a resolved track → music block runs
    const musicComposer = {
      loopMusic: vi.fn(async () => {
        // throw a NON-Error -> finalize catch ternary false side
        const boom: unknown = 'loop string boom';
        throw boom;
      }),
      appendMusic: vi.fn(async () => undefined),
    };
    const { editor, logger, project: proj } = makeEditor({ template, project, musicComposer });

    await expect(editor.finalize(segments)).rejects.toBe('loop string boom');
    expect(logger.error).toHaveBeenCalledWith('[Finalize] Error: Unknown error');
    expect(proj.errors).toContain('finalize');
  });
});
