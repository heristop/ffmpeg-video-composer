import { describe, it, expect, vi, afterEach } from 'vitest';

// expo-file-system is native-only; the adapter only reads its two directories at construction.
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  downloadAsync: vi.fn(async () => ({ status: 200 })),
  readAsStringAsync: vi.fn(),
  EncodingType: { Base64: 'base64' },
}));

import * as FileSystem from 'expo-file-system/legacy';
import FilesystemExpoAdapter from '@/platform/filesystem/FilesystemExpoAdapter';

describe('FilesystemExpoAdapter.fetch', () => {
  // Two requests for one font face in a section download the same URL concurrently: a shared temp
  // file would be truncated under the first download and the second move would find it gone.
  it('gives every download its own temp file', async () => {
    const adapter = new FilesystemExpoAdapter();

    const first = await adapter.fetch('https://fonts.gstatic.com/s/roboto/v51/face.ttf');
    const second = await adapter.fetch('https://fonts.gstatic.com/s/roboto/v51/face.ttf');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^\/cache\/[\w-]+-face\.ttf$/);
    expect(vi.mocked(FileSystem.downloadAsync)).toHaveBeenCalledWith(
      'https://fonts.gstatic.com/s/roboto/v51/face.ttf',
      `file://${first}`
    );
  });
});

describe('FilesystemExpoAdapter.fetchAndRead', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Google keys the CSS format off the User-Agent: the header the font resolver sends must reach the
  // request on-device too, not only on Node.
  it('forwards request headers', async () => {
    const fetchMock = vi.fn(async () => new Response('css', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await new FilesystemExpoAdapter().fetchAndRead('https://fonts.googleapis.com/css2?family=Inter', {
      'User-Agent': 'Mozilla/4.0',
    });

    expect(fetchMock).toHaveBeenCalledWith('https://fonts.googleapis.com/css2?family=Inter', {
      headers: { 'User-Agent': 'Mozilla/4.0' },
    });
  });

  // Like the Node adapter, an HTTP error rejects instead of handing its body over as if it were CSS
  // (a 429 would otherwise be reported as "check the family name exists").
  it('rejects on an HTTP error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Too Many Requests', { status: 429 }))
    );

    await expect(
      new FilesystemExpoAdapter().fetchAndRead('https://fonts.googleapis.com/css2?family=Inter')
    ).rejects.toThrow(/429/);
  });
});

describe('FilesystemExpoAdapter.readFile', () => {
  // expo-file-system hands a file over as padded base64. A JPEG whose length is not a multiple of three
  // lost its last bytes (its EOI marker) on the way: the HTML layer's portrait then drew as nothing on the
  // phone, and its PNG differed from Node's.
  it.each([1, 2, 3, 149_144])('returns the %i bytes of the file unchanged', async (length) => {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 0xd9) & 255);
    vi.mocked(FileSystem.readAsStringAsync).mockResolvedValueOnce(Buffer.from(bytes).toString('base64'));

    expect(await new FilesystemExpoAdapter().readFile('/cache/leclap-assets/backgrounds/photo.jpg')).toEqual(bytes);
  });
});
