import { CoreCompilationService } from './CoreCompilationService';
import * as Leclap from '@/modules/leclap-ffmpeg';
import * as FileSystem from 'expo-file-system/legacy';
import { compileReactNative } from 'ffmpeg-video-composer/reactnative';
import type { CompileInput } from './CompileService';

// The app's type program uses vitest globals (declarations.d.ts), but this colocated test
// executes under jest (ts-jest, transpile-only), so the jest runtime value is typed locally.
type MockFn = ((...args: never[]) => unknown) & {
  mock: { calls: unknown[][] };
  mockImplementation(impl: (...args: never[]) => unknown): MockFn;
  mockResolvedValue(value: unknown): MockFn;
};

declare const jest: {
  mock(moduleName: string, factory: () => unknown): void;
  fn(impl?: (...args: never[]) => unknown): MockFn;
  clearAllMocks(): void;
};

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('@/modules/leclap-ffmpeg', () => ({
  run: jest.fn(),
  probe: jest.fn(),
  cancel: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(null),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1024 }),
  copyAsync: jest.fn().mockResolvedValue(null),
  moveAsync: jest.fn().mockResolvedValue(null),
}));

// expo-asset and the media catalog pull in Metro-bundled `require('*.mp3')` assets that ts-jest
// can't resolve — mock both so the bundled-music staging path runs without real binaries.
jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: jest.fn(() => ({
      downloadAsync: jest.fn().mockResolvedValue({
        localUri: 'file:///asset/point-being.mp3',
        uri: 'file:///asset/point-being.mp3',
      }),
    })),
  },
}));

jest.mock('@/src/data/mediaCatalog', () => ({
  MUSIC_ASSETS: { 'point-being.mp3': 42 },
  FONT_ASSETS: { 'BebasNeue.ttf': 7 },
  VIDEO_ASSETS: { 'leclap_bumper.mp4': 99 },
  BACKGROUND_ASSETS: { 'desk-flatlay.jpg': 55 },
  findBackground: (id: string) => (id === 'desk-flatlay' ? { id, file: 'desk-flatlay.jpg' } : undefined),
}));

jest.mock('ffmpeg-video-composer/reactnative', () => ({
  compileReactNative: jest.fn(),
}));

const input = { descriptor: { sections: [] }, clips: {} } as unknown as CompileInput;

beforeEach(() => jest.clearAllMocks());

describe('CoreCompilationService abort wiring', () => {
  it('forwards an abort to the native cancel while compiling', async () => {
    const controller = new AbortController();

    (compileReactNative as unknown as MockFn).mockImplementation(async () => {
      controller.abort();
      return '/cache/out.mp4';
    });

    await new CoreCompilationService().compile(input, { signal: controller.signal });

    expect(Leclap.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not cancel after the compile finished', async () => {
    const controller = new AbortController();

    (compileReactNative as unknown as MockFn).mockResolvedValue('/cache/out.mp4');

    await new CoreCompilationService().compile(input, { signal: controller.signal });
    controller.abort();

    expect(Leclap.cancel).not.toHaveBeenCalled();
  });
});

describe('CoreCompilationService quality-tier threading', () => {
  it('passes qualityTier through to the ProjectConfig verbatim when set', async () => {
    (compileReactNative as unknown as MockFn).mockResolvedValue('/cache/out.mp4');

    await new CoreCompilationService().compile({ ...input, qualityTier: 'high' });

    const [projectConfig] = (compileReactNative as unknown as MockFn).mock.calls[0] as [{ qualityTier?: string }];
    expect(projectConfig.qualityTier).toBe('high');
  });

  it('omits qualityTier from the ProjectConfig when unset', async () => {
    (compileReactNative as unknown as MockFn).mockResolvedValue('/cache/out.mp4');

    await new CoreCompilationService().compile(input);

    const [projectConfig] = (compileReactNative as unknown as MockFn).mock.calls[0] as [{ qualityTier?: string }];
    expect(projectConfig.qualityTier).toBeUndefined();
  });
});

describe('CoreCompilationService bundled-asset staging', () => {
  const withMusic = {
    descriptor: { sections: [], global: { music: { name: 'point-being.mp3' } } },
    clips: {},
  } as unknown as CompileInput;

  const copiedTo = (): string[] =>
    (FileSystem.copyAsync as unknown as MockFn).mock.calls.map((c) => (c[0] as { to: string }).to);

  it('stages the bundled fonts and default music into the assets dir when not present', async () => {
    // Not yet staged → the core would otherwise abort (missing font → drawtext rc=-22, or
    // "Music URL is not provided" for the track).
    (FileSystem.getInfoAsync as unknown as MockFn).mockResolvedValue({ exists: false });
    (compileReactNative as unknown as MockFn).mockResolvedValue('/cache/out.mp4');

    await new CoreCompilationService().compile(withMusic);

    expect(copiedTo()).toContain('file:///cache/leclap-assets/fonts/BebasNeue.ttf');
    expect(copiedTo()).toContain('file:///cache/leclap-assets/musics/point-being.mp3');
    // The brand bumper must be staged so the core resolves it locally instead of downloading its
    // canonical URL (which 404s on-device → AVERROR_INVALIDDATA).
    expect(copiedTo()).toContain('file:///cache/leclap-assets/videos/leclap_bumper.mp4');
  });

  it('skips copying when the assets are already staged', async () => {
    (FileSystem.getInfoAsync as unknown as MockFn).mockResolvedValue({ exists: true });
    (compileReactNative as unknown as MockFn).mockResolvedValue('/cache/out.mp4');

    await new CoreCompilationService().compile(withMusic);

    expect((FileSystem.copyAsync as unknown as MockFn).mock.calls.length).toBe(0);
  });
});

describe('CoreCompilationService watermark staging', () => {
  const withLibraryWatermark = {
    descriptor: { sections: [], global: { watermark: { url: 'library://desk-flatlay', position: 'top-left' } } },
    clips: {},
  } as unknown as CompileInput;

  it('stages a library watermark into assetsDir/backgrounds and rewrites its url', async () => {
    (FileSystem.getInfoAsync as unknown as MockFn).mockResolvedValue({ exists: false });
    (compileReactNative as unknown as MockFn).mockResolvedValue('/cache/out.mp4');

    await new CoreCompilationService().compile(withLibraryWatermark);

    const copiedTo = (FileSystem.copyAsync as unknown as MockFn).mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(copiedTo).toContain('file:///cache/leclap-assets/backgrounds/desk-flatlay.jpg');

    // Same descriptor object is mutated then handed to the core — assert the canonical rewrite the
    // core's FilesystemExpoAdapter.resolveLocalAsset resolves offline, not the original library:// marker.
    const [, passedDescriptor] = (compileReactNative as unknown as MockFn).mock.calls[0] as [
      unknown,
      { global?: { watermark?: { url?: string; position?: string } } },
    ];
    expect(passedDescriptor.global?.watermark?.url).toBe('/assets/backgrounds/desk-flatlay.jpg');
    expect(passedDescriptor.global?.watermark?.position).toBe('top-left');
  });

  it('does not stage or rewrite a URL watermark (fetched remotely by the core)', async () => {
    (FileSystem.getInfoAsync as unknown as MockFn).mockResolvedValue({ exists: false });
    (compileReactNative as unknown as MockFn).mockResolvedValue('/cache/out.mp4');

    const withUrlWatermark = {
      descriptor: { sections: [], global: { watermark: { url: 'https://example.com/logo.png' } } },
      clips: {},
    } as unknown as CompileInput;

    await new CoreCompilationService().compile(withUrlWatermark);

    const copiedTo = (FileSystem.copyAsync as unknown as MockFn).mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(copiedTo.some((p) => p.includes('backgrounds'))).toBe(false);

    const [, passedDescriptor] = (compileReactNative as unknown as MockFn).mock.calls[0] as [
      unknown,
      { global?: { watermark?: { url?: string } } },
    ];
    expect(passedDescriptor.global?.watermark?.url).toBe('https://example.com/logo.png');
  });

  it('skips copying when the watermark background is already staged', async () => {
    (FileSystem.getInfoAsync as unknown as MockFn).mockResolvedValue({ exists: true });
    (compileReactNative as unknown as MockFn).mockResolvedValue('/cache/out.mp4');

    await new CoreCompilationService().compile(withLibraryWatermark);

    expect((FileSystem.copyAsync as unknown as MockFn).mock.calls.length).toBe(0);
  });
});

describe('CoreCompilationService image_background staging', () => {
  it('stages a bundled image_background pictureUrl so the segment can render', async () => {
    (FileSystem.getInfoAsync as unknown as MockFn).mockResolvedValue({ exists: false });
    (compileReactNative as unknown as MockFn).mockResolvedValue('/cache/out.mp4');

    const withImageBackground = {
      descriptor: {
        sections: [
          {
            type: 'image_background',
            name: 'backdrop',
            options: { pictureUrl: '/assets/backgrounds/desk-flatlay.jpg', duration: 4 },
          },
        ],
      },
      clips: {},
    } as unknown as CompileInput;

    await new CoreCompilationService().compile(withImageBackground);

    const copiedTo = (FileSystem.copyAsync as unknown as MockFn).mock.calls.map((c) => (c[0] as { to: string }).to);
    // Without this staging the background image never lands on device and the render fails ffprobe.
    expect(copiedTo).toContain('file:///cache/leclap-assets/backgrounds/desk-flatlay.jpg');
  });
});

describe('CoreCompilationService output publishing', () => {
  it('moves each render off the shared engine output so later renders cannot overwrite it', async () => {
    (FileSystem.getInfoAsync as unknown as MockFn).mockResolvedValue({ exists: true, size: 1024 });
    (compileReactNative as unknown as MockFn).mockResolvedValue('/cache/build/output.mp4');
    const service = new CoreCompilationService();

    const first = await service.compile(input);
    const second = await service.compile(input);

    expect(first.success && second.success).toBe(true);
    expect(first.success && second.success && first.outputUri).not.toBe(second.success && second.outputUri);
    expect((FileSystem.moveAsync as unknown as MockFn).mock.calls[0][0]).toEqual({
      from: 'file:///cache/build/output.mp4',
      to: expect.stringMatching(/^file:\/\/\/cache\/leclap-outputs\/.+\.mp4$/),
    });
  });
});
