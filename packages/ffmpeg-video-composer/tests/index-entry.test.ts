import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// index.ts owns platform bootstrap + the public compile()/loadConfig() API.
// We mock the platform bridge and the director so the DI graph initializes
// with controllable fakes and never reaches real FFmpeg.
// ---------------------------------------------------------------------------

const createAdapter = vi.fn();
const fsRead = vi.fn(async (_path: string) => JSON.stringify({ sections: [] }));
const construct = vi.fn(async () => '/build/out.mp4');
const configFn = vi.fn(function (this: unknown) {
  return this;
});

// Fake filesystem adapter used both for loadConfig and director wiring.
const fakeFilesystem = {
  read: (p: string) => fsRead(p),
  setBuildDir: vi.fn(),
  setAssetsDir: vi.fn(),
  getBuildPath: vi.fn(async (d: string) => `/build/${d}`),
};

const fakeLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('@/platform/PlatformBridge', () => {
  class MockPlatformBridge {
    async create(kind: string): Promise<unknown> {
      createAdapter(kind);
      switch (kind) {
        case 'filesystem':
          return fakeFilesystem;
        case 'logger':
          return fakeLogger;
        case 'ffmpeg':
          return { execute: vi.fn(), getInfos: vi.fn() };
        case 'music':
          return { compose: vi.fn() };
        default:
          return {};
      }
    }
    isNodeEnvironment(): boolean {
      return true;
    }
  }

  return { default: MockPlatformBridge };
});

// A dependency-free director the tsyringe container can instantiate directly. Exposes the same
// `events` emitter the real director publishes progress on, so compile() can subscribe to it.
vi.mock('@/director/TemplateDirector', () => {
  class MockTemplateDirector {
    config = configFn;
    construct = construct;
    events = { on: vi.fn(), off: vi.fn() };
  }

  return { default: MockTemplateDirector };
});

// Keep the lazily-imported editor/manager registrations cheap and side-effect free.
vi.mock('@/platform/EventManager', () => ({
  default: class {
    connect() {
      return { on: vi.fn() };
    }
  },
}));
vi.mock('@/editor/VideoEditor', () => ({ default: class {} }));
vi.mock('@/editor/MusicComposer', () => ({ default: class {} }));
vi.mock('@/director/TemplateConcreteBuilder', () => ({ default: class {} }));

async function loadIndex() {
  return await import('@/index');
}

describe('index.ts compile / loadConfig', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fsRead.mockResolvedValue(JSON.stringify({ sections: [] }));
    construct.mockResolvedValue('/build/out.mp4');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('rejects unresolved effects before platform initialization and reports the error', async () => {
    vi.resetModules();
    const { compile } = await loadIndex();
    const onError = vi.fn();
    const effect = {
      type: 'effect',
      name: 'intro',
      effect: { id: 'leclap.title-reveal', version: '1.0.0', props: {}, assets: {} },
      options: { duration: 2 },
    };
    expect(await compile({ buildDir: '/build' }, { sections: [effect] }, { onError })).toBeNull();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/effect_backend_unavailable.*intro/) })
    );
    expect(createAdapter).not.toHaveBeenCalled();
    expect(construct).not.toHaveBeenCalled();
  });

  it('rejects a variable-produced effect before platform initialization', async () => {
    const { compile } = await loadIndex();
    const onError = vi.fn();
    const descriptor = {
      sections: [{ type: 'partial', ref: 'title', variables: { kind: 'effect' } }],
      partials: [{ id: 'title', sections: [{ type: '{{kind}}', name: 'intro' }] }],
    };
    expect(await compile({ buildDir: '/build' }, descriptor as never, { onError })).toBeNull();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('effect_backend_unavailable') })
    );
    expect(createAdapter).not.toHaveBeenCalled();
    expect(construct).not.toHaveBeenCalled();
  });

  it('loadConfig reads and parses the config JSON', async () => {
    const { loadConfig } = await loadIndex();
    fsRead.mockResolvedValue(JSON.stringify({ global: { orientation: 'landscape' } }));
    const descriptor = await loadConfig('config.json');
    expect(descriptor).toEqual({ global: { orientation: 'landscape' } });
    expect(fsRead).toHaveBeenCalledWith('config.json');
  });

  it('loadConfig wraps read failures with a descriptive Error', async () => {
    const { loadConfig } = await loadIndex();
    fsRead.mockRejectedValue(new Error('ENOENT'));
    await expect(loadConfig('missing.json')).rejects.toThrow(/Failed to load config from missing.json: ENOENT/);
  });

  it('loadConfig surfaces a JSON parse failure', async () => {
    const { loadConfig } = await loadIndex();
    fsRead.mockResolvedValue('{ not json ');
    await expect(loadConfig('bad.json')).rejects.toThrow(/Failed to load config from bad.json/);
  });

  it('loadConfig rethrows a non-Error read failure verbatim (no wrapping)', async () => {
    const { loadConfig } = await loadIndex();
    // read() rejects with a NON-Error value -> the catch's `instanceof Error`
    // guard is false, so the original value is rethrown unwrapped.
    fsRead.mockRejectedValue('boom');
    await expect(loadConfig('weird.json')).rejects.toBe('boom');
  });

  it('compile returns the director output on success', async () => {
    const { compile } = await loadIndex();
    const result = await compile({ buildDir: '/build' }, { sections: [] });
    expect(result).toBe('/build/out.mp4');
    expect(configFn).toHaveBeenCalled();
    expect(construct).toHaveBeenCalled();
  });

  it('compile logs whether user video paths were supplied', async () => {
    const { compile } = await loadIndex();
    await compile({ buildDir: '/build', userVideoPaths: { intro: '/v.mp4' } }, { sections: [] });
    expect(fakeLogger.info).toHaveBeenCalledWith(
      'Starting compilation',
      expect.objectContaining({ hasUserVideoPaths: true })
    );
  });

  it('compile returns null when buildDir is missing', async () => {
    const { compile } = await loadIndex();
    const result = await compile({}, { sections: [] });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('buildDir is required'));
  });

  it('compile returns null and logs when the director throws', async () => {
    const { compile } = await loadIndex();
    construct.mockRejectedValue(new Error('director failure'));
    const result = await compile({ buildDir: '/build' }, { sections: [] });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('director failure'));
  });

  it('compile returns null when a non-Error is thrown', async () => {
    const { compile } = await loadIndex();
    construct.mockRejectedValue('plain failure');
    const result = await compile({ buildDir: '/build' }, { sections: [] });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('Unknown compilation error');
  });

  it('re-exports the public surface', async () => {
    const mod = await loadIndex();
    expect(mod.TemplateDirector).toBeDefined();
    expect(mod.container).toBeDefined();
    expect(mod.Terminal).toBeDefined();
    expect(mod.FFmpegDetector).toBeDefined();
  });
});
