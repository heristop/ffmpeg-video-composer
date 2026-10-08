// The optional AbortSignal of compileVideo: what it can stop and how the render reports it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  compile: vi.fn(),
  emit: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('reflect-metadata', () => ({}));
vi.mock('ffmpeg-video-composer/src/browser.ts', () => ({
  compileBrowser: mocks.compile,
  container: { resolve: () => ({ connect: () => ({ emit: mocks.emit }) }) },
}));
vi.mock('ffmpeg-video-composer/src/platform/filesystem/BrowserFilesystemAdapter.ts', () => ({
  default: class {
    clear = mocks.clear;
    ensureDir = vi.fn();
    storeFile = vi.fn();
    writeFile = vi.fn();
    readFile = vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3])));
    remove = vi.fn();
  },
}));
vi.mock('@leclap/creative-kit/fonts', () => ({ FONTS: [] }));
vi.mock('@leclap/creative-kit/render-quips', () => ({ renderQuip: () => '' }));
vi.mock('@/services/templateService', () => ({}));
vi.mock('@/lib/logger', () => ({
  compilationLogger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));
vi.mock('@/domain/valueObjects/videoEdits', () => ({ applyVideoEdits: vi.fn() }));
vi.mock('@/infrastructure/ffmpeg-core', () => ({ loadSelfHostedCore: vi.fn() }));
vi.mock('@/infrastructure/html-engine', () => ({ loadSelfHostedHtmlWasm: vi.fn() }));
vi.mock('@/services/browserMediaService', () => ({ browserMediaService: {} }));
vi.mock('@/application/usecases/materializeTemplateMedia', () => ({ materializeTemplateMedia: vi.fn() }));
vi.mock('@/application/usecases/applyMediaChoices', () => ({ applyMediaChoices: vi.fn() }));
vi.mock('@/application/usecases/musicBeats', () => ({ analyzeMusicInBrowser: vi.fn() }));
vi.mock('@/services/templatePartialService', () => ({
  materializeTemplatePartials: (descriptor: unknown) => descriptor,
}));

const { coreCompilationService } = await import('./coreCompilationService');

const config = {
  template: { id: 't', descriptor: { global: {}, sections: [] } },
  formData: {},
  files: [],
} as unknown as Parameters<typeof coreCompilationService.compileVideo>[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:out');
});

describe('compileVideo abort signal', () => {
  it('renders normally without a signal', async () => {
    mocks.compile.mockResolvedValue('/tmp/build/out.mp4');

    await expect(coreCompilationService.compileVideo(config, vi.fn())).resolves.toMatchObject({ url: 'blob:out' });
  });

  it('hands the engine the self-hosted ffmpeg core and html rasteriser', async () => {
    const { loadSelfHostedCore } = await import('@/infrastructure/ffmpeg-core');
    const { loadSelfHostedHtmlWasm } = await import('@/infrastructure/html-engine');
    mocks.compile.mockResolvedValue('/tmp/build/out.mp4');

    await coreCompilationService.compileVideo(config, vi.fn());

    expect(mocks.compile.mock.calls[0][3]).toEqual({
      loadFFmpegCore: loadSelfHostedCore,
      loadHtmlWasm: loadSelfHostedHtmlWasm,
    });
  });

  it('stops before touching the filesystem when aborted up front', async () => {
    const abort = new AbortController();
    abort.abort();

    await expect(coreCompilationService.compileVideo(config, vi.fn(), abort.signal)).rejects.toMatchObject({
      failure: { kind: 'stopped' },
    });
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.compile).not.toHaveBeenCalled();
  });

  it('tells the engine to stop when aborted mid-compile, and reports stopped', async () => {
    const abort = new AbortController();
    mocks.compile.mockImplementation(() => {
      abort.abort();

      // The director halts at its next segment boundary and hands back no output.
      return Promise.resolve(undefined);
    });

    await expect(coreCompilationService.compileVideo(config, vi.fn(), abort.signal)).rejects.toMatchObject({
      failure: { kind: 'stopped' },
    });
    expect(mocks.emit).toHaveBeenCalledWith('task-cancelled');
  });

  it('ignores an abort after the render finished', async () => {
    const abort = new AbortController();
    mocks.compile.mockResolvedValue('/tmp/build/out.mp4');

    await expect(coreCompilationService.compileVideo(config, vi.fn(), abort.signal)).resolves.toMatchObject({
      url: 'blob:out',
    });
    abort.abort();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
