import { inject, injectable } from 'tsyringe';
import { promises as fs, createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import axios, { type AxiosResponse, type ResponseType } from 'axios';
import AbstractFilesystem from './AbstractFilesystem';
import { assertSafeRemoteUrl } from './url-guard';
import { creativeKitCandidates, isBundledAssetName, sourceLayoutCandidates } from './bundled-asset-paths';
import { catalogAssetUrl, catalogMissError, isCatalogAssetPath } from '../../core/asset-source';
import type AbstractLogger from '../../platform/logging/AbstractLogger';

// Cap on redirect hops the guarded follower will chase before giving up. Bounds
// redirect loops and long chains; legitimate media/font URLs resolve in 0-1 hops.
const MAX_REDIRECT_HOPS = 5;

// Close each download connection when its response ends. Node 19+ defaults the global agent to
// keepAlive:true, which pools these sockets open ~25s after a render and keeps the event loop alive —
// the CLI/MCP process appears to hang well after the output is printed. One-shot media fetches gain
// nothing from connection reuse, so opt out explicitly.
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

// Optional bounds for one request. `timeoutMs` is axios' idle-socket timeout — the request is
// abandoned once the connection makes no progress for that long — and `maxBytes` caps the response
// body. Left out, axios' own defaults apply (no timeout, no cap), which is what the render path has
// always used.
export interface RequestLimits {
  timeoutMs?: number;
  maxBytes?: number;
}

// Follow HTTP redirects manually so the async SSRF guard runs on *every* hop, not
// just the first URL. axios' built-in redirect handling (maxRedirects > 0) would
// chase a 302 with no re-check, letting a public bait URL bounce to a private/
// metadata host. Here we keep maxRedirects: 0 and, on each 3xx Location, resolve the
// target against the current URL, re-run assertSafeRemoteUrl, then re-request — so a
// redirect to 169.254.169.254 (or any RFC1918/loopback host) is rejected, while a
// legitimate redirect to another public host is followed.
async function requestWithGuardedRedirects(
  url: string,
  responseType: ResponseType,
  origin: string = url,
  hop = 0,
  options: RequestLimits & { headers?: Record<string, string> } = {}
): Promise<AxiosResponse> {
  if (hop > MAX_REDIRECT_HOPS) {
    throw new Error(`Too many redirects (more than ${MAX_REDIRECT_HOPS}) while fetching ${origin}`);
  }

  // Guard this URL (including the very first one) before issuing the request.
  await assertSafeRemoteUrl(url);

  const response = await axios({
    method: 'get',
    url,
    responseType,
    headers: options.headers,
    maxRedirects: 0,
    httpAgent,
    httpsAgent,
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    ...(options.maxBytes === undefined ? {} : { maxContentLength: options.maxBytes }),
    // Accept 3xx as a non-error response so we can read Location and re-validate the
    // next hop ourselves; without this axios rejects 3xx when maxRedirects is 0.
    validateStatus: (status) => (status >= 200 && status < 300) || (status >= 300 && status < 400),
  });

  if (response.status < 300 || response.status >= 400) {
    return response;
  }

  const location = response.headers.location as string | undefined;

  if (!location) {
    return response;
  }

  // Resolve relative Locations against the current URL (absolute ones pass through),
  // then recurse so the destination is guarded before the next request.
  const next = new URL(location, url).toString();

  return requestWithGuardedRedirects(next, responseType, origin, hop + 1, options);
}

@injectable()
class FilesystemNodeAdapter extends AbstractFilesystem {
  protected override root: string = globalThis.process.cwd();
  protected override tempDir: string = os.tmpdir();

  // Optional because the Node entry builds this adapter through PlatformBridge (`new AdapterClass()`),
  // outside DI: there is no logger in production, so logging must never be what throws.
  constructor(@inject('logger') private readonly logger?: AbstractLogger) {
    super();
  }

  override getAssetsPath = async (dir: string): Promise<string> => {
    // Resolve under the configured assets directory (set from ProjectConfig.assetsDir by the
    // director), consistent with getSource() for videos. This keeps asset resolution independent
    // of process.cwd(). Fall back to the monorepo source layout only when nothing is configured.
    if (this.assetsDir) {
      return path.join(this.assetsDir, dir);
    }

    return path.join(this.root, 'packages', 'leclap-creative-kit', 'src', 'assets', dir);
  };

  override getBuildPath = async (dir: string): Promise<string> => {
    const fullPath = path.join(this.buildDir ?? '', dir);
    await fs.mkdir(fullPath, { recursive: true });

    return fullPath;
  };

  override getSource = (segmentName: string | undefined): string => {
    const resolvedName = segmentName ?? this.segmentName;

    return resolvedName ? path.join(this.assetsDir ?? '', 'videos', `${resolvedName}.mp4`) : '';
  };

  override getDestination = (): string => path.join(this.buildDir ?? '', `${this.segmentName}_output.mp4`);

  // Allow copying a local file only when it resolves under a known staging dir (assetsDir/tempDir/
  // buildDir). Symlinks are resolved first so a template descriptor can't traverse out of tree
  // (e.g. point pictureUrl/music at /etc/passwd or an ssh key).
  private readonly resolveStagedPath = async (url: string): Promise<string> => {
    const roots = [this.assetsDir, this.tempDir, this.buildDir].filter((r): r is string => Boolean(r));
    // Resolve the source and every staging root in parallel; roots that don't exist yet resolve to ''.
    const [real, ...realRoots] = await Promise.all([
      fs.realpath(url),
      ...roots.map((root) => fs.realpath(root).catch(() => '')),
    ]);

    if (realRoots.some((root) => root !== '' && (real === root || real.startsWith(root + path.sep)))) {
      return real;
    }

    throw new Error(
      `Refusing to read a file outside the staged media directories: ${url} is not under the assets dir (${this.assetsDir ?? 'unset'})`
    );
  };

  // Decide how fetch() satisfies a reference. Returns null when it was served from a local staged copy
  // (already written to `dest`), otherwise the remote URL to download. An http(s) URL passes through; a
  // reference with no staged copy is resolved against the public asset library when it's a bare
  // catalog-relative path (videos/…, pictures/…), while absolute/schemed paths re-raise the staging
  // rejection and any other local path (`bg.png`) fails here: neither is ever remapped to a remote.
  private readonly resolveFetchUrl = async (url: string, dest: string): Promise<string | null> => {
    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    const local = await this.resolveStagedPath(this.localCandidate(url)).catch(() => null);

    if (local) {
      await fs.copyFile(local, dest);

      return null;
    }

    if (url.startsWith('/') || url.includes('://')) {
      await this.resolveStagedPath(this.localCandidate(url));
    }

    if (!isCatalogAssetPath(url)) {
      throw new Error(
        `"${url}" was not found in the assets dir (${this.assetsDir ?? 'unset'}). A local path is never fetched ` +
          'remotely: copy the file into the assets dir, or reference it by an http(s) URL.'
      );
    }

    return catalogAssetUrl(url);
  };

  override fetch = async (url: string): Promise<string> => {
    // A unique temp name per download: concurrent renders (MCP workers), or two requests for one font
    // face in a section, fetching the same URL would otherwise truncate and interleave writes in one
    // shared file — the first to finish would carry a zero-filled hole onward, into the font cache too.
    const dest = path.join(this.tempDir, `${randomUUID()}-${path.basename(url)}`);
    const remote = await this.resolveFetchUrl(url, dest);

    if (remote === null) {
      return dest;
    }

    // SSRF guard: reject non-http(s) schemes and private/reserved destinations
    // (cloud metadata, loopback, RFC1918, ...) — re-checked on every redirect hop.
    const response = await requestWithGuardedRedirects(remote, 'stream').catch((error: unknown) => {
      throw remote === url ? error : catalogMissError(url, remote, this.assetsDir, error);
    });

    const writer = createWriteStream(dest);

    try {
      await new Promise<void>((resolve, reject) => {
        // Without listening on the source stream a mid-download failure (e.g. a
        // throttled connection) would leave a truncated file on disk that still
        // looks like a successful fetch.
        response.data.on('error', reject);
        writer.on('error', reject);
        writer.on('finish', () => {
          resolve();
        });
        response.data.pipe(writer);
      });
    } catch (error) {
      writer.destroy();
      // Wait for the writer to close first: its open is async, so an unlink racing a pending open
      // misses and the open then recreates the file. Drop the partial file so a later read can't
      // pick up corrupt content.
      await finished(writer).catch(() => {});
      await fs.unlink(dest).catch(() => {});

      throw error;
    }

    return dest;
  };

  // Download a small remote file straight into memory, bounded by `limits`. Unlike fetch(), nothing
  // is written under `tempDir`: fetch() stages every download at `tempDir/<basename>`, a path shared
  // with any render staging the same asset, which a caller that only wants the bytes has no business
  // truncating or deleting.
  fetchBytes = async (url: string, limits: RequestLimits): Promise<Uint8Array> => {
    const response = await requestWithGuardedRedirects(url, 'arraybuffer', url, 0, limits);

    // requestWithGuardedRedirects hands back a 3xx that carries no Location rather than following it.
    if (response.status >= 300) {
      throw new Error(`Unexpected HTTP ${response.status} while fetching ${url}`);
    }

    return new Uint8Array(response.data as ArrayBuffer);
  };

  // Resolve a template asset to an already-present local file under the configured assetsDir, so a
  // render whose media is staged locally runs offline. A descriptor may reference the asset as a
  // local path or as a URL whose path mirrors the assets layout (…/assets/<subdir>/<file>); both map
  // to a candidate under assetsDir. Returns null (→ caller downloads) when nothing's configured or
  // present. resolveStagedPath enforces the result stays under a staging root (no path traversal).
  override resolveLocalAsset = async (url: string): Promise<string | null> => {
    if (!this.assetsDir && !url.startsWith('/')) return null;

    try {
      return await this.resolveStagedPath(this.localCandidate(url));
    } catch {
      return null;
    }
  };

  override async readTemplateFont(src: string): Promise<Uint8Array | null> {
    return (await import('./template-font-read')).readTemplateFontWithin(this.fontRoots(), src);
  }

  // The local path a descriptor asset reference maps to. A `/assets/...` reference is a web-rooted
  // asset path (what the web builder emits) and maps under assetsDir; a `/...` path WITHOUT the
  // `/assets/` marker is a real absolute device path, used as-is; a relative path is assets-relative.
  // Mirrors the Expo and Browser adapters.
  private readonly localCandidate = (url: string): string => {
    const isDevicePath = url.startsWith('/') && !url.includes('/assets/');

    return isDevicePath ? url : path.join(this.assetsDir ?? '', this.assetsRelativeFromUrl(url));
  };

  // Path after the last `/assets/` segment of a URL (…/assets/pictures/logo.png → pictures/logo.png),
  // falling back to the bare basename so a flat assets dir still resolves.
  private readonly assetsRelativeFromUrl = (url: string): string => {
    const marker = '/assets/';
    const index = url.lastIndexOf(marker);

    if (index !== -1) return url.slice(index + marker.length);

    // A bare relative path (no URL scheme) is already assets-relative — keep its subdirs intact.
    if (!url.includes('://')) return url;

    return url.slice(url.lastIndexOf('/') + 1);
  };

  override stat = async (filePath: string): Promise<boolean> => {
    try {
      await fs.stat(filePath);

      return true;
    } catch {
      return false;
    }
  };

  override read = async (filePath: string): Promise<string> => {
    return await fs.readFile(filePath, 'utf-8');
  };

  override readFile = async (filePath: string): Promise<Uint8Array> => {
    return await fs.readFile(filePath);
  };

  override copy = async (sourcePath: string, targetPath: string): Promise<void> => {
    await fs.copyFile(sourcePath, targetPath);
  };

  // Resolve a file shipped with the package (under `library/<kind>`) to an absolute local path.
  // Returns null when it isn't reachable. `libraryCandidates` says where the creative kit's copy may
  // be: fonts WALK UP from the module directory (creativeKitCandidates) rather than hard-coding a hop
  // count, because a fixed `../../../../` resolves from `src/platform/filesystem/` (vitest, which
  // aliases `@/` to source) and lands outside the repo from `dist/` (every built consumer — the CLI,
  // the MCP server, any library user). That is why `leclap validate` reported every geometry finding
  // as approximate while the engine's own tests measured real glyphs. Music deliberately keeps the
  // fixed candidate; see sourceLayoutCandidates.
  private async resolveBundledAsset(
    kind: string,
    file: string,
    libraryCandidates: (moduleDir: string, kind: string, file: string) => string[]
  ): Promise<string | null> {
    const moduleDir = this.bundledModuleDir();

    if (moduleDir === null || !isBundledAssetName(file)) {
      return null;
    }

    const candidates = [path.join(moduleDir, kind, file), ...libraryCandidates(moduleDir, kind, file)];
    const present = await Promise.all(candidates.map((candidate) => this.stat(candidate)));
    const index = present.findIndex(Boolean);

    return index === -1 ? null : candidates[index];
  }

  // The directory this module runs from: `src/platform/filesystem/` under vitest, `dist/` once built.
  // A method so a test can stand it inside a synthetic package layout.
  protected bundledModuleDir(): string | null {
    try {
      return path.dirname(fileURLToPath(import.meta.url));
    } catch {
      return null;
    }
  }

  // Find a bundled font so drawtext works offline and out-of-the-box on Node (server/MCP/library) —
  // the previous behaviour downloaded from Google Fonts, which fails for the bundled single-token
  // family names (BebasNeue, PlayfairDisplay, …).
  override resolveBundledFont = (fontFile: string): Promise<string | null> =>
    this.resolveBundledAsset('fonts', fontFile, creativeKitCandidates);

  // Find a bundled colour-emoji image, walking up to the creative kit like the fonts (plain blobs, read only).
  override resolveBundledEmoji = (file: string): Promise<string | null> =>
    this.resolveBundledAsset('emoji', file, creativeKitCandidates);

  // Find a bundled music track so `global.music` resolves offline on Node (server/MCP/library)
  // instead of requiring a network download.
  override resolveBundledMusic = (musicFile: string): Promise<string | null> =>
    this.resolveBundledAsset('musics', musicFile, sourceLayoutCandidates);

  // Sound effects are small plain blobs (not Git-LFS) that are only ever read, so they walk up like fonts.
  override resolveBundledSfx = (sfxFile: string): Promise<string | null> =>
    this.resolveBundledAsset('sfx', sfxFile, creativeKitCandidates);

  // A font downloaded by an earlier render, kept OUTSIDE the build dir (which is wiped between runs)
  // so a repeat render of the same resolved font needs no network. Overridable with FVC_FONT_CACHE_DIR
  // so a CI job can point it at a warm, shared directory.
  private fontCacheDir(): string {
    const configured = process.env.FVC_FONT_CACHE_DIR?.trim();

    if (configured) {
      return configured;
    }

    return path.join(os.homedir(), '.cache', 'leclap', 'fonts');
  }

  // Where a font lives in the cache, or null when it can't be cached. The key must be a bare file
  // name: a template-authored legacy name like `Roboto-/../google-inter-700.ttf` would otherwise read
  // or overwrite files outside the cache dir — another font's entry included. A home dir that can't
  // be resolved (no HOME, no passwd entry) simply means no cache.
  private cachedFontPath(fontFile: string): string | null {
    if (fontFile === '' || fontFile === '.' || fontFile === '..' || path.basename(fontFile) !== fontFile) {
      return null;
    }

    try {
      return path.join(this.fontCacheDir(), fontFile);
    } catch {
      return null;
    }
  }

  override resolveCachedFont = async (fontFile: string): Promise<string | null> => {
    const cached = this.cachedFontPath(fontFile);

    return cached && (await this.stat(cached)) ? cached : null;
  };

  // Best-effort by contract: a cache that cannot be written (read-only home, full disk) must never
  // fail a render that has already produced the font. The entry is written under a unique temporary
  // name and renamed into place — atomic within the directory — so a concurrent render sharing the
  // cache, or one killed mid-copy, can never pick up a half-written face as a cache hit.
  override cacheFont = async (fontFile: string, stagedPath: string): Promise<void> => {
    const target = this.cachedFontPath(fontFile);

    if (!target) {
      return;
    }

    const partial = `${target}.${process.pid}-${Date.now()}.partial`;

    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(stagedPath, partial);
      await fs.rename(partial, target);
    } catch (error) {
      await fs.unlink(partial).catch(() => {});
      const params = error instanceof Error ? { message: error.message } : undefined;
      this.logger?.warn(`Could not cache font ${fontFile}:`, params);
    }
  };

  override move = async (sourcePath: string, targetPath: string): Promise<void> => {
    const exists = await fs
      .access(sourcePath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new Error(`${sourcePath} not found`);
    }

    // Stage into a not-yet-existing dir (e.g. a fresh assets/videos/) and tolerate a cross-device
    // rename (tempDir on a different volume than the target): mkdir -p, then rename, then copy+unlink.
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    try {
      await fs.rename(sourcePath, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error;
      }

      await fs.copyFile(sourcePath, targetPath);
      await fs.unlink(sourcePath);
    }
  };

  override unlink = (filePath: string): Promise<void> => {
    this.write(filePath).catch(() => {});

    return fs.unlink(filePath);
  };

  override write = (targetPath: string): Promise<void> => fs.writeFile(targetPath, '');

  override writeFile = async (path: string, data: Uint8Array): Promise<void> => {
    await fs.writeFile(path, data);
  };

  append = async (targetPath: string, content: string): Promise<void> => {
    if (
      !(await fs
        .access(targetPath)
        .then(() => true)
        .catch(() => false))
    ) {
      throw new Error(`${targetPath} doesn't exist`);
    }

    return fs.appendFile(targetPath, content);
  };

  fetchAndRead = async (url: string, headers?: Record<string, string>): Promise<string> => {
    try {
      // SSRF guard: same class as fetch() — a template-supplied font URL must not be able to
      // reach cloud metadata, loopback, or RFC1918 hosts, on the first request or any redirect.
      // Google Fonts CSS can answer 302, so redirects are followed but re-validated per hop.
      const response = await requestWithGuardedRedirects(url, 'text', url, 0, { headers });

      return response.data;
    } catch (error) {
      const params = error instanceof Error ? { message: error.message } : undefined;
      this.logger?.error(`Error downloading from ${url}:`, params);

      throw error;
    }
  };
}

export default FilesystemNodeAdapter;
