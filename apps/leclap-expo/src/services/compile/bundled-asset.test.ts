import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { bundledAssetFile, stageBundledAsset } from './bundled-asset';

declare const jest: {
  mock(moduleName: string, factory: () => unknown): void;
  fn(impl?: (...args: never[]) => unknown): unknown;
  clearAllMocks(): void;
};

type Mock = {
  mock: { calls: unknown[][] };
  mockImplementation(impl: (...args: never[]) => unknown): void;
};

interface Source {
  name: string;
  type: string;
  hash: string | null;
  uri: string;
  localUri?: string | null;
}

// Files on the fake device, and what ExpoAsset's native download writes for a source uri.
const files = new Set<string>();
const nativeDownloads = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: files.has(uri), isDirectory: false })),
  copyAsync: jest.fn(async ({ to }: { to: string }) => {
    files.add(to);
  }),
}));

jest.mock('expo-asset', () => {
  // The real Asset: `new Asset(source)` is not downloaded yet, so downloadAsync goes through the native module.
  class FakeAsset {
    name: string;
    type: string;
    hash: string | null;
    uri: string;
    localUri: string | null = null;

    constructor({ name, type, hash, uri }: Source) {
      this.name = name;
      this.type = type;
      this.hash = hash;
      this.uri = uri;
    }

    async downloadAsync(): Promise<this> {
      this.localUri = nativeDownloads.get(this.uri) ?? null;

      return this;
    }

    static fromModule = jest.fn();
  }

  return { Asset: FakeAsset };
});

const fromModule = Asset.fromModule as unknown as Mock;

// What Asset.fromModule(module) hands back, already "downloaded" as expo-asset leaves it.
function bundled(source: Source): void {
  fromModule.mockImplementation(() => ({ ...source, downloadAsync: async () => source }));
}

beforeEach(() => {
  jest.clearAllMocks();
  files.clear();
  nativeDownloads.clear();
});

describe('bundledAssetFile', () => {
  it('uses the local file expo-asset downloaded (debug builds, iOS release)', async () => {
    const localUri = 'file:///data/cache/ExponentAsset-abc.mp3';

    files.add(localUri);
    bundled({ name: 'point-being', type: 'mp3', hash: 'abc', uri: 'http://10.0.2.2:8081/assets/x.mp3', localUri });

    await expect(bundledAssetFile(42)).resolves.toBe(localUri);
    expect(fromModule.mock.calls).toEqual([[42]]);
  });

  it('copies an Android release image out of its drawable resource name', async () => {
    // expo-asset keeps an Android image's resource name as its localUri, marked downloaded, for <Image>.
    const resource = 'assets_backgrounds_cafetable';
    const copy = 'file:///data/cache/ExponentAsset-cafe.jpg';

    bundled({ name: 'cafe-table', type: 'jpg', hash: 'cafe', uri: resource, localUri: resource });
    nativeDownloads.set(resource, copy);
    files.add(copy);

    await expect(bundledAssetFile(55)).resolves.toBe(copy);
  });

  it('downloads again when the local file is gone', async () => {
    const stale = 'file:///data/cache/ExponentAsset-gone.ttf';
    const fresh = 'file:///data/cache/ExponentAsset-font.ttf';

    bundled({ name: 'Rubik', type: 'ttf', hash: 'font', uri: 'assets_fonts_rubik', localUri: stale });
    nativeDownloads.set('assets_fonts_rubik', fresh);
    files.add(fresh);

    await expect(bundledAssetFile(7)).resolves.toBe(fresh);
  });

  it('names the asset when no readable file comes out', async () => {
    bundled({ name: 'cafe-table', type: 'jpg', hash: 'cafe', uri: 'assets_backgrounds_cafetable', localUri: null });

    await expect(bundledAssetFile(55)).rejects.toThrow(
      'the bundled asset cafe-table.jpg has no readable file (assets_backgrounds_cafetable)'
    );
  });
});

describe('stageBundledAsset', () => {
  it('copies the readable file to the destination path', async () => {
    const resource = 'assets_backgrounds_cafetable';
    const copy = 'file:///data/cache/ExponentAsset-cafe.jpg';

    bundled({ name: 'cafe-table', type: 'jpg', hash: 'cafe', uri: resource, localUri: resource });
    nativeDownloads.set(resource, copy);
    files.add(copy);

    await stageBundledAsset(55, '/data/cache/leclap-assets/backgrounds/cafe-table.jpg');

    expect((FileSystem.copyAsync as unknown as Mock).mock.calls).toEqual([
      [{ from: copy, to: 'file:///data/cache/leclap-assets/backgrounds/cafe-table.jpg' }],
    ]);
  });

  it('leaves an already staged file alone', async () => {
    files.add('file:///data/cache/leclap-assets/fonts/Rubik.ttf');

    await stageBundledAsset(7, '/data/cache/leclap-assets/fonts/Rubik.ttf');

    expect(fromModule.mock.calls).toEqual([]);
    expect((FileSystem.copyAsync as unknown as Mock).mock.calls).toEqual([]);
  });
});
