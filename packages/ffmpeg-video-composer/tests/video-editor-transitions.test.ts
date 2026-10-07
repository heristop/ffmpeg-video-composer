import 'reflect-metadata';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import VideoEditor from '@/editor/VideoEditor';
import type { FFMpegInfos, ProjectConfig, TemplateDescriptor } from '@/core/types';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeProject(config: ProjectConfig = {}) {
  return {
    finalVideo: '',
    output: { staging: '', final: '' },
    ffmpegVersion: null,
    errors: [] as string[],
    config: {
      audioConfig: { sampleRate: 48000, channelLayout: 'stereo' },
      ...config,
    },
    buildInfos: { fileConcatPath: '/build/segments.list', musicPath: '' },
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

function infos(duration: number, audioCodec: string | null = 'aac'): FFMpegInfos {
  return { duration, videoCodec: 'h264', audioCodec, sampleRate: 48000 };
}

function makeEditor(
  opts: {
    project?: ReturnType<typeof makeProject>;
    template?: ReturnType<typeof makeTemplate>;
    filesystem?: ReturnType<typeof makeFilesystem>;
    ffmpeg?: { execute: ReturnType<typeof vi.fn>; getInfos: ReturnType<typeof vi.fn> };
  } = {}
) {
  const project = opts.project ?? makeProject();
  const template = opts.template ?? makeTemplate();
  const filesystem = opts.filesystem ?? makeFilesystem();
  const ffmpeg = opts.ffmpeg ?? {
    execute: vi.fn(async () => ({ rc: 0 })),
    getInfos: vi.fn(async () => infos(5)),
  };
  const musicComposer = { loopMusic: vi.fn(async () => undefined), appendMusic: vi.fn(async () => undefined) };
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

  return { editor, project, template, filesystem, ffmpeg, logger };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VideoEditor.assembleWithTransitions', () => {
  it('builds xfade/acrossfade graph with cumulative offsets for 3 segments', async () => {
    const durations = [5, 4, 6];
    const ffmpeg = {
      execute: vi.fn(async () => ({ rc: 0 })),
      getInfos: vi.fn(async (src: string) => infos(durations[Number(src.match(/(\d)/)?.[1] ?? 0)])),
    };
    const { editor, ffmpeg: f } = makeEditor({ ffmpeg });

    const result = await editor.assembleWithTransitions(
      ['/build/s0.mp4', '/build/s1.mp4', '/build/s2.mp4'],
      [
        { type: 'wipeleft', duration: 0.5 },
        { type: 'dissolve', duration: 0.4 },
      ]
    );

    expect(result).toBe('/build/output.mp4');
    const command = f.execute.mock.calls[0][0] as string;
    expect(command).toContain('xfade=transition=wipeleft:duration=0.5:offset=4.5');
    expect(command).toContain('xfade=transition=dissolve:duration=0.4:offset=8.1');
    expect(command).toContain('acrossfade=d=0.5:c1=tri:c2=tri');
    expect(command).toContain('acrossfade=d=0.4:c1=tri:c2=tri');
    expect(command).toContain('-map "[vout]"');
    expect(command).toContain('-map "[aout]"');
    expect(command).toContain('-r 30');
    expect(command).toContain('-movflags +faststart');
  });

  it('synthesizes a silent audio leg via aevalsrc for a silent middle segment', async () => {
    const durations = [5, 4, 6];
    const audio: Array<string | null> = ['aac', null, 'aac'];
    const ffmpeg = {
      execute: vi.fn(async () => ({ rc: 0 })),
      getInfos: vi.fn(async (src: string) => {
        const i = Number(src.match(/(\d)/)?.[1] ?? 0);
        return infos(durations[i], audio[i]);
      }),
    };
    const { editor, ffmpeg: f } = makeEditor({ ffmpeg });

    await editor.assembleWithTransitions(
      ['/build/s0.mp4', '/build/s1.mp4', '/build/s2.mp4'],
      [
        { type: 'wipeleft', duration: 0.5 },
        { type: 'dissolve', duration: 0.4 },
      ]
    );

    const command = f.execute.mock.calls[0][0] as string;
    expect(command).toContain('aevalsrc=0:d=4:s=48000');
    // The silent middle segment's audio leg comes from the synthesized lavfi input (index 3,
    // appended after the 3 segment inputs), not from its own missing [1:a].
    expect(command).toContain('[3:a]');
    expect(command).not.toContain('[1:a]');
  });

  it('caps a transition to half the shorter adjacent segment so short clips do not collapse', async () => {
    // Three 0.5s clips with authored 0.5s fades. Naively offset_k = Σd − Σtr would be 0 for every
    // boundary (the whole timeline overlaps into one clip — the xfade-short-segment-collapse). The
    // transition must be capped to ≤ half the shorter adjacent segment (0.25s) so offsets stay
    // strictly increasing and the draft keeps a watchable duration.
    const ffmpeg = {
      execute: vi.fn(async () => ({ rc: 0 })),
      getInfos: vi.fn(async () => infos(0.5)),
    };
    const { editor, ffmpeg: f } = makeEditor({ ffmpeg });

    await editor.assembleWithTransitions(
      ['/build/s0.mp4', '/build/s1.mp4', '/build/s2.mp4'],
      [
        { type: 'fade', duration: 0.5 },
        { type: 'fade', duration: 0.5 },
      ]
    );

    const command = f.execute.mock.calls[0][0] as string;
    // Capped to 0.25s, with strictly-increasing offsets (0.25, then 0.5) — never offset=0.
    expect(command).toContain('xfade=transition=fade:duration=0.25:offset=0.25');
    expect(command).toContain('xfade=transition=fade:duration=0.25:offset=0.5');
    expect(command).not.toContain('offset=0[');
    expect(command).toContain('acrossfade=d=0.25:c1=tri:c2=tri');
  });

  it('leaves a transition shorter than half the adjacent segments untouched', async () => {
    // 5s/4s/6s clips with 0.5s/0.4s transitions: half the shorter adjacent (2s, 2s) far exceeds the
    // authored durations, so they pass through unchanged (same as the cumulative-offset baseline).
    const durations = [5, 4, 6];
    const ffmpeg = {
      execute: vi.fn(async () => ({ rc: 0 })),
      getInfos: vi.fn(async (src: string) => infos(durations[Number(src.match(/(\d)/)?.[1] ?? 0)])),
    };
    const { editor, ffmpeg: f } = makeEditor({ ffmpeg });

    await editor.assembleWithTransitions(
      ['/build/s0.mp4', '/build/s1.mp4', '/build/s2.mp4'],
      [
        { type: 'wipeleft', duration: 0.5 },
        { type: 'dissolve', duration: 0.4 },
      ]
    );

    const command = f.execute.mock.calls[0][0] as string;
    expect(command).toContain('xfade=transition=wipeleft:duration=0.5:offset=4.5');
    expect(command).toContain('xfade=transition=dissolve:duration=0.4:offset=8.1');
  });

  it('lowers fadefast and fadeslow straight to their xfade names', async () => {
    const durations = [5, 4, 6];
    const ffmpeg = {
      execute: vi.fn(async () => ({ rc: 0 })),
      getInfos: vi.fn(async (src: string) => infos(durations[Number(src.match(/(\d)/)?.[1] ?? 0)])),
    };
    const { editor, ffmpeg: f } = makeEditor({ ffmpeg });

    await editor.assembleWithTransitions(
      ['/build/s0.mp4', '/build/s1.mp4', '/build/s2.mp4'],
      [
        { type: 'fadefast', duration: 0.5 },
        { type: 'fadeslow', duration: 0.4 },
      ]
    );

    const command = f.execute.mock.calls[0][0] as string;
    expect(command).toContain('xfade=transition=fadefast:duration=0.5:offset=4.5');
    expect(command).toContain('xfade=transition=fadeslow:duration=0.4:offset=8.1');
  });

  it('joins a cut boundary with concat (a sub-frame xfade ends the output early on FFmpeg 6)', async () => {
    const { editor, ffmpeg } = makeEditor();

    await editor.assembleWithTransitions(['/build/s0.mp4', '/build/s1.mp4'], [{ type: 'cut', duration: 0 }]);

    const command = ffmpeg.execute.mock.calls[0][0] as string;
    expect(command).toContain('[vs0][vs1]concat=n=2:v=1:a=0[vout]');
    expect(command).toContain('[0:a][1:a]concat=n=2:v=0:a=1[aout]');
    expect(command).not.toContain('xfade');
  });

  it('throws when the transitions list length does not equal segments-1', async () => {
    const { editor, ffmpeg } = makeEditor();

    await expect(
      editor.assembleWithTransitions(
        ['/build/s0.mp4', '/build/s1.mp4', '/build/s2.mp4'],
        [{ type: 'wipeleft', duration: 0.5 }]
      )
    ).rejects.toThrow();
    expect(ffmpeg.execute).not.toHaveBeenCalled();
  });

  it('throws for a single segment (no boundary to transition)', async () => {
    const { editor } = makeEditor();

    await expect(editor.assembleWithTransitions(['/build/s0.mp4'], [])).rejects.toThrow();
  });

  it('propagates adapter failure without falling back to concat', async () => {
    const ffmpeg = {
      execute: vi.fn(async () => ({ rc: 1 })),
      getInfos: vi.fn(async () => infos(5)),
    };
    const { editor, ffmpeg: f } = makeEditor({ ffmpeg });

    await expect(
      editor.assembleWithTransitions(['/build/s0.mp4', '/build/s1.mp4'], [{ type: 'wipeleft', duration: 0.5 }])
    ).rejects.toThrow();
    // No concat command issued — failure propagates as-is.
    expect(f.execute).not.toHaveBeenCalledWith(expect.stringContaining('-f concat'));
  });

  it('emits the videotoolbox encoder piece when hwaccel videotoolbox is configured', async () => {
    const project = makeProject({ codecConfig: { videoCodec: 'h264_videotoolbox' } });
    const { editor, ffmpeg } = makeEditor({ project });

    await editor.assembleWithTransitions(['/build/s0.mp4', '/build/s1.mp4'], [{ type: 'wipeleft', duration: 0.5 }]);

    const command = ffmpeg.execute.mock.calls[0][0] as string;
    expect(command).toContain('-c:v h264_videotoolbox -b:v 8M');
  });
});
