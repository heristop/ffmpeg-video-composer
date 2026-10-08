import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import fsModule, { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock axios so both fetch() (stream) and fetchAndRead() (text) — which now route
// through the same callable axios(config) helper — can be driven through their
// success, redirect, and error paths without touching the network.
vi.mock('axios', () => {
  const mock = vi.fn() as ReturnType<typeof vi.fn> & { get: ReturnType<typeof vi.fn> };
  mock.get = vi.fn();

  return { default: mock };
});
import axios from 'axios';

// Mock DNS resolution so the SSRF guard can be exercised deterministically without
// touching a real resolver (and so we can simulate rebinding to a private IP).
const mockedLookup = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => mockedLookup(...args) }));

import FilesystemNodeAdapter from '@/platform/filesystem/FilesystemNodeAdapter';

const mockedAxios = axios as unknown as ReturnType<typeof vi.fn>;
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeAdapter(): FilesystemNodeAdapter {
  return new FilesystemNodeAdapter(logger as never);
}

// Build a 3xx redirect response carrying a Location header (as axios exposes it).
function redirectTo(location: string, status = 302) {
  return { status, headers: { location }, data: null };
}

// Build a terminal 200 response with the given body.
function ok(data: unknown) {
  return { status: 200, headers: {}, data };
}

describe('FilesystemNodeAdapter.fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: hostnames resolve to a public address unless a test overrides it.
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('streams the response body to a temp file and returns its path', async () => {
    mockedAxios.mockResolvedValue(ok(Readable.from(['hello world'])));

    const dest = await makeAdapter().fetch('https://example.com/file.bin');

    expect(path.dirname(dest)).toBe(os.tmpdir());
    expect(path.basename(dest)).toMatch(/-file\.bin$/);
    expect(await fs.readFile(dest, 'utf-8')).toBe('hello world');

    await fs.unlink(dest).catch(() => undefined);
  });

  it('rejects and removes the partial file when the source stream errors', async () => {
    const errStream = new Readable({
      read() {
        this.destroy(new Error('stream boom'));
      },
    });
    mockedAxios.mockResolvedValue(ok(errStream));

    const name = `err-${process.pid}.bin`;

    await expect(makeAdapter().fetch(`https://example.com/${name}`)).rejects.toThrow('stream boom');
    // The partial download must not be left behind.
    expect((await fs.readdir(os.tmpdir())).filter((file) => file.endsWith(`-${name}`))).toEqual([]);
  });

  it('removes the partial file even when the write stream opens after the source failed', async () => {
    // Under load the write stream's async open can land after the source already errored; an unlink
    // issued before that open would miss, and the open would then recreate an empty file.
    const realOpen = fsModule.open;
    let opened: Promise<void> = Promise.resolve();
    const openSpy = vi.spyOn(fsModule, 'open').mockImplementation(((file: string, flags: string, mode: number, cb) => {
      opened = new Promise((resolve) => {
        setTimeout(() => {
          realOpen(file, flags, mode, (error, fd) => {
            cb(error, fd);
            resolve();
          });
        }, 10);
      });
    }) as typeof realOpen);
    const errStream = new Readable({
      read() {
        this.destroy(new Error('late open boom'));
      },
    });
    mockedAxios.mockResolvedValue(ok(errStream));

    const dest = path.join(os.tmpdir(), 'late-open.bin');

    try {
      await expect(makeAdapter().fetch('https://example.com/late-open.bin')).rejects.toThrow('late open boom');
    } finally {
      openSpy.mockRestore();
    }

    // Check only once the delayed open has landed, so a file it recreated would be visible.
    await opened;
    await expect(fs.access(dest)).rejects.toBeInstanceOf(Error);
    await fs.unlink(dest).catch(() => undefined);
  });
});

describe('FilesystemNodeAdapter.fetchBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('returns the body in memory without staging anything under tempDir', async () => {
    mockedAxios.mockResolvedValue(ok(Buffer.from('font bytes')));

    const bytes = await makeAdapter().fetchBytes('https://cdn.example.com/Probe.ttf', { timeoutMs: 5000 });

    expect(Buffer.from(bytes).toString('utf-8')).toBe('font bytes');
    // fetch() would have written tempDir/Probe.ttf — the path a render stages the same asset through.
    await expect(fs.access(path.join(os.tmpdir(), 'Probe.ttf'))).rejects.toBeInstanceOf(Error);
  });

  it('hands its limits to axios', async () => {
    mockedAxios.mockResolvedValue(ok(Buffer.from('x')));

    await makeAdapter().fetchBytes('https://cdn.example.com/a.ttf', { timeoutMs: 5000, maxBytes: 1024 });

    expect(mockedAxios.mock.calls[0]?.[0]).toMatchObject({
      responseType: 'arraybuffer',
      timeout: 5000,
      maxContentLength: 1024,
    });
  });

  it('leaves fetch() unbounded, as the render path has always been', async () => {
    mockedAxios.mockResolvedValue(ok(Readable.from(['body'])));

    const dest = await makeAdapter().fetch('https://cdn.example.com/defaults.bin');

    expect(mockedAxios.mock.calls[0]?.[0]).not.toHaveProperty('timeout');
    expect(mockedAxios.mock.calls[0]?.[0]).not.toHaveProperty('maxContentLength');

    await fs.unlink(dest).catch(() => undefined);
  });

  it('rejects a redirect it was not allowed to follow instead of returning its body', async () => {
    mockedAxios.mockResolvedValue({ status: 302, headers: {}, data: Buffer.from('<html>moved</html>') });

    await expect(makeAdapter().fetchBytes('https://cdn.example.com/a.ttf', { timeoutMs: 5000 })).rejects.toThrow(
      'HTTP 302'
    );
  });

  it('is guarded against private destinations like every other request', async () => {
    await expect(makeAdapter().fetchBytes('http://169.254.169.254/latest/', { timeoutMs: 5000 })).rejects.toThrow();
    expect(mockedAxios).not.toHaveBeenCalled();
  });
});

describe('FilesystemNodeAdapter.fetch SSRF guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.mockResolvedValue(ok(Readable.from(['public body'])));
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('rejects a non-http(s) scheme (file://) before fetching', async () => {
    await expect(makeAdapter().fetch('file:///etc/passwd')).rejects.toThrow();
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it('rejects the cloud-metadata link-local address', async () => {
    await expect(makeAdapter().fetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it('rejects localhost and loopback literals', async () => {
    await expect(makeAdapter().fetch('http://localhost:9200/')).rejects.toThrow();
    await expect(makeAdapter().fetch('http://127.0.0.1/')).rejects.toThrow();
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it('rejects private RFC1918 ranges', async () => {
    await expect(makeAdapter().fetch('http://10.0.0.5/x')).rejects.toThrow();
    await expect(makeAdapter().fetch('http://192.168.1.1/')).rejects.toThrow();
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it('rejects a public hostname that resolves (rebinds) to a private IP', async () => {
    mockedLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(makeAdapter().fetch('https://evil.example.com/clip.mp4')).rejects.toThrow();
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it('allows a normal public host and proceeds with the download', async () => {
    const dest = await makeAdapter().fetch('https://cdn.example.com/clip.mp4');

    expect(mockedLookup).toHaveBeenCalledWith('cdn.example.com', { all: true });
    expect(mockedAxios).toHaveBeenCalledTimes(1);
    expect(path.dirname(dest)).toBe(os.tmpdir());
    expect(path.basename(dest)).toMatch(/-clip\.mp4$/);
    expect(await fs.readFile(dest, 'utf-8')).toBe('public body');

    await fs.unlink(dest).catch(() => undefined);
  });

  it('issues the request with maxRedirects: 0 so axios never follows redirects unchecked', async () => {
    await makeAdapter().fetch('https://cdn.example.com/clip.mp4');

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    expect(mockedAxios.mock.calls[0]?.[0]).toMatchObject({ maxRedirects: 0, responseType: 'stream' });
  });

  it('issues the request with keep-alive disabled so sockets do not linger after a render', async () => {
    await makeAdapter().fetch('https://cdn.example.com/clip.mp4');

    // Node 19+ defaults the global agent to keepAlive:true, which pools the download socket open ~25s
    // after a render and blocks the CLI/MCP process from exiting. These one-shot fetches pass explicit
    // agents that close the connection when the response ends.
    const cfg = mockedAxios.mock.calls[0]?.[0] as {
      httpAgent?: { keepAlive?: boolean };
      httpsAgent?: { keepAlive?: boolean };
    };
    expect(cfg.httpAgent?.keepAlive).toBe(false);
    expect(cfg.httpsAgent?.keepAlive).toBe(false);
  });
});

describe('FilesystemNodeAdapter.fetch guarded redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('follows a 302 from a public host to a second public host and downloads the final body', async () => {
    mockedAxios
      .mockResolvedValueOnce(redirectTo('https://cdn2.example.com/clip.mp4'))
      .mockResolvedValueOnce(ok(Readable.from(['final body'])));

    const dest = await makeAdapter().fetch('https://cdn.example.com/clip.mp4');

    expect(mockedAxios).toHaveBeenCalledTimes(2);
    // Both hops were guarded (DNS-checked) before their request.
    expect(mockedLookup).toHaveBeenCalledWith('cdn.example.com', { all: true });
    expect(mockedLookup).toHaveBeenCalledWith('cdn2.example.com', { all: true });
    expect(mockedAxios.mock.calls[1]?.[0]).toMatchObject({ url: 'https://cdn2.example.com/clip.mp4' });
    expect(await fs.readFile(dest, 'utf-8')).toBe('final body');

    await fs.unlink(dest).catch(() => undefined);
  });

  it('rejects a 302 from a public host to a private/metadata IP (SSRF still closed on the redirect hop)', async () => {
    mockedAxios.mockResolvedValueOnce(redirectTo('http://169.254.169.254/latest/meta-data/'));

    await expect(makeAdapter().fetch('https://cdn.example.com/clip.mp4')).rejects.toThrow(/private|reserved/i);
    // Only the first (public) request fired; the redirect target was rejected before its request.
    expect(mockedAxios).toHaveBeenCalledTimes(1);
  });

  it('resolves a relative Location against the current URL and re-guards it', async () => {
    mockedAxios
      .mockResolvedValueOnce(redirectTo('/elsewhere/clip.mp4'))
      .mockResolvedValueOnce(ok(Readable.from(['rel body'])));

    const dest = await makeAdapter().fetch('https://cdn.example.com/dir/clip.mp4');

    expect(mockedAxios.mock.calls[1]?.[0]).toMatchObject({ url: 'https://cdn.example.com/elsewhere/clip.mp4' });
    expect(await fs.readFile(dest, 'utf-8')).toBe('rel body');

    await fs.unlink(dest).catch(() => undefined);
  });

  it('throws when the redirect chain exceeds the hop limit (loop protection)', async () => {
    // Always redirect back to a public host so the guard passes but the loop never terminates.
    mockedAxios.mockResolvedValue(redirectTo('https://cdn.example.com/loop'));

    await expect(makeAdapter().fetch('https://cdn.example.com/loop')).rejects.toThrow(/too many redirects/i);
  });
});

describe('FilesystemNodeAdapter.fetch local staged path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies a local file under the staged assets dir without hitting the network', async () => {
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vp-stage-'));
    const source = path.join(stageDir, 'staged.bin');
    await fs.writeFile(source, 'staged content');

    const adapter = makeAdapter();
    adapter.setAssetsDir(stageDir);

    const dest = await adapter.fetch(source);

    expect(mockedAxios).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
    expect(await fs.readFile(dest, 'utf-8')).toBe('staged content');

    await fs.rm(stageDir, { recursive: true, force: true });
    await fs.unlink(dest).catch(() => undefined);
  });
});

describe('FilesystemNodeAdapter.fetch catalog-relative fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.mockResolvedValue(ok(Readable.from(['clip bytes'])));
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('resolves a bare catalog-relative path with no local copy against the public library and downloads it', async () => {
    // A descriptor references `videos/outro.mp4` (no scheme, no leading slash). With no assetsDir staged
    // copy, the Node adapter must fetch it from the public asset library rather than realpath-crashing.
    const dest = await makeAdapter().fetch('videos/outro.mp4');

    expect(mockedLookup).toHaveBeenCalledWith('github.com', { all: true });
    expect(mockedAxios.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://github.com/heristop/leclap/raw/main/packages/leclap-creative-kit/src/library/videos/outro.mp4',
    });
    expect(path.dirname(dest)).toBe(os.tmpdir());
    expect(path.basename(dest)).toMatch(/-outro\.mp4$/);
    expect(await fs.readFile(dest, 'utf-8')).toBe('clip bytes');

    await fs.unlink(dest).catch(() => undefined);
  });

  it('prefers a locally staged copy over the remote library when one is present', async () => {
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vp-cat-'));
    await fs.mkdir(path.join(stageDir, 'videos'), { recursive: true });
    await fs.writeFile(path.join(stageDir, 'videos', 'outro.mp4'), 'local clip');

    const adapter = makeAdapter();
    adapter.setAssetsDir(stageDir);

    const dest = await adapter.fetch('videos/outro.mp4');

    expect(mockedAxios).not.toHaveBeenCalled();
    expect(await fs.readFile(dest, 'utf-8')).toBe('local clip');

    await fs.rm(stageDir, { recursive: true, force: true });
    await fs.unlink(dest).catch(() => undefined);
  });

  it('never remaps an absolute device path to the remote library (still rejected when unstaged)', async () => {
    await expect(makeAdapter().fetch('/etc/passwd')).rejects.toThrow();
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  // A media path the author meant as local (`bg.png` next to their other media) used to be fetched from
  // the remote catalog when it was missing, so the error was the network's (a 404, or "self-signed
  // certificate" behind a TLS-intercepting proxy) instead of "this file is not in the assets dir".
  it('never fetches a local path the catalog cannot hold, and names it and the assets dir', async () => {
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vp-local-'));
    const adapter = makeAdapter();
    adapter.setAssetsDir(stageDir);

    for (const ref of ['bg.png', 'images/bg.png', './bg.png', '~/bg.png']) {
      const failure = adapter.fetch(ref);

      await expect(failure).rejects.toThrow(ref);
      await expect(failure).rejects.toThrow(`not found in the assets dir (${stageDir})`);
    }

    expect(mockedAxios).not.toHaveBeenCalled();
    await fs.rm(stageDir, { recursive: true, force: true });
  });

  it('names the assets dir when an absolute path is outside it', async () => {
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vp-abs-'));
    const adapter = makeAdapter();
    adapter.setAssetsDir(stageDir);

    await expect(adapter.fetch('/etc/passwd')).rejects.toThrow(`assets dir (${stageDir})`);
    await fs.rm(stageDir, { recursive: true, force: true });
  });

  it('says the catalog could not serve a missing catalog path, with the cause', async () => {
    mockedAxios.mockRejectedValue(new Error('self-signed certificate in certificate chain'));
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vp-cat-miss-'));
    const adapter = makeAdapter();
    adapter.setAssetsDir(stageDir);

    const failure = adapter.fetch('pictures/mine.png');

    await expect(failure).rejects.toThrow(`"pictures/mine.png" is not in the assets dir (${stageDir})`);
    await expect(failure).rejects.toThrow('asset catalog');
    await expect(failure).rejects.toThrow('self-signed certificate in certificate chain');
    await fs.rm(stageDir, { recursive: true, force: true });
  });
});

describe('FilesystemNodeAdapter.fetchAndRead SSRF guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.mockResolvedValue(ok('body { font-family: x; }'));
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('rejects the cloud-metadata link-local address before fetching', async () => {
    await expect(makeAdapter().fetchAndRead('http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it('rejects localhost before fetching', async () => {
    await expect(makeAdapter().fetchAndRead('http://localhost:9200/')).rejects.toThrow();
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it('rejects a public hostname that resolves (rebinds) to a private IP', async () => {
    mockedLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(makeAdapter().fetchAndRead('https://evil.example.com/css')).rejects.toThrow();
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it('allows a normal public host and returns the response body', async () => {
    const body = await makeAdapter().fetchAndRead('https://fonts.googleapis.com/css?family=Roboto');

    expect(mockedLookup).toHaveBeenCalledWith('fonts.googleapis.com', { all: true });
    expect(mockedAxios).toHaveBeenCalledTimes(1);
    expect(mockedAxios.mock.calls[0]?.[0]).toMatchObject({ maxRedirects: 0, responseType: 'text' });
    expect(body).toBe('body { font-family: x; }');
  });

  it('follows a 302 (Google Fonts CSS) to a second public host and returns the final body', async () => {
    mockedAxios
      .mockResolvedValueOnce(redirectTo('https://fonts.gstatic.com/real.css'))
      .mockResolvedValueOnce(ok('@font-face { src: url(x); }'));

    const body = await makeAdapter().fetchAndRead('https://fonts.googleapis.com/css?family=Roboto');

    expect(mockedAxios).toHaveBeenCalledTimes(2);
    expect(mockedLookup).toHaveBeenCalledWith('fonts.gstatic.com', { all: true });
    expect(body).toBe('@font-face { src: url(x); }');
  });

  it('rejects a 302 to a private IP on the redirect hop (SSRF still closed)', async () => {
    mockedAxios.mockResolvedValueOnce(redirectTo('http://127.0.0.1/secret'));

    await expect(makeAdapter().fetchAndRead('https://fonts.googleapis.com/css')).rejects.toThrow(/private|reserved/i);
    expect(mockedAxios).toHaveBeenCalledTimes(1);
  });
});

describe('FilesystemNodeAdapter.append', () => {
  it("throws when the target file doesn't exist", async () => {
    const missing = path.join(os.tmpdir(), `vp-missing-${process.pid}.txt`);

    await expect(makeAdapter().append(missing, 'x')).rejects.toThrow(/doesn't exist/);
  });

  it('appends content to an existing file', async () => {
    const target = path.join(os.tmpdir(), `vp-append-${process.pid}.txt`);
    await fs.writeFile(target, 'a');

    await makeAdapter().append(target, 'b');

    expect(await fs.readFile(target, 'utf-8')).toBe('ab');

    await fs.unlink(target).catch(() => undefined);
  });
});

describe('FilesystemNodeAdapter.move', () => {
  it('throws when the source path does not exist', async () => {
    const missing = path.join(os.tmpdir(), `vp-nosrc-${process.pid}.bin`);

    await expect(makeAdapter().move(missing, path.join(os.tmpdir(), 'dst.bin'))).rejects.toThrow(/not found/);
  });

  it('creates the target parent directory when staging into a not-yet-existing subdir', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vp-move-'));
    const src = path.join(base, 'src.bin');
    await fs.writeFile(src, 'staged clip');
    // `videos/` does not exist yet — move must mkdir -p the destination dir before renaming.
    const target = path.join(base, 'assets', 'videos', 'video_1.mp4');

    await makeAdapter().move(src, target);

    expect(await fs.readFile(target, 'utf-8')).toBe('staged clip');

    await fs.rm(base, { recursive: true, force: true });
  });
});
