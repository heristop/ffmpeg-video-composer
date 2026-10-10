import * as FileSystem from 'expo-file-system/legacy';
import { base64ToBytes, bytesToBase64 } from '../../editor/html/base64';
import AbstractFilesystem from './AbstractFilesystem';

/**
 * React-Native filesystem adapter backed by expo-file-system. The native FFmpeg engine reads/writes
 * REAL device paths, while expo-file-system speaks `file://` URIs — so this adapter stores and
 * returns plain paths (what ffmpeg commands need) and converts to URIs only at the FS boundary.
 *
 * Lives in the core (behind AbstractFilesystem) but only loaded by the React-Native entry, so the
 * Node/web builds never resolve expo-file-system.
 */
function toUri(p: string): string {
  return p.startsWith('file://') ? p : `file://${p}`;
}

function toPath(p: string): string {
  return p.replace(/^file:\/\//, '');
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

// The path a canonical asset URL maps to under `assetsDir` (mirrors the Node adapter): everything
// after the `/assets/` marker (keeping subdirs like `videos/leclap_bumper.mp4`), or the basename for
// a flat URL. Lets the app's bundled-and-staged copy satisfy a descriptor's remote `videoUrl`.
function assetsRelativeFromUrl(url: string): string {
  const marker = '/assets/';
  const index = url.lastIndexOf(marker);

  if (index !== -1) return url.slice(index + marker.length);

  if (!url.includes('://')) return url;

  return basename(url);
}

class FilesystemExpoAdapter extends AbstractFilesystem {
  protected override root: string = toPath(FileSystem.documentDirectory ?? '');
  protected override tempDir: string = toPath(FileSystem.cacheDirectory ?? '');

  override getAssetsPath = async (dir: string): Promise<string> => join(this.assetsDir ?? '', dir);

  // Resolve a font the app staged under `assetsDir/fonts` (its Metro-bundled .ttf, copied there
  // before compile). Mirrors the Node adapter resolving `dist/fonts` — so on-device renders use the
  // bundled font offline instead of the Google Fonts download, which can't resolve multi-word
  // families (e.g. "Bebas Neue" from a `BebasNeue.ttf` filename) and rate-limits.
  override resolveBundledFont = async (fontFile: string): Promise<string | null> => {
    const path = join(this.assetsDir ?? '', 'fonts', fontFile);

    return (await FileSystem.getInfoAsync(toUri(path))).exists ? path : null;
  };

  // Resolve a descriptor asset URL (e.g. the bumper's canonical `videoUrl`) to the app's bundled copy
  // staged under `assetsDir` — returning null only when no local copy exists, so the core downloads.
  // Without this, the on-device fetch hits the canonical URL, which 404s to an HTML page → the engine
  // reads invalid input (AVERROR_INVALIDDATA). Mirrors the Node and Browser adapters.
  override resolveLocalAsset = async (url: string): Promise<string | null> => {
    if (!this.assetsDir && !url.startsWith('/')) return null;

    // A real absolute device path (no `/assets/` marker) is used as-is; a web `/assets/...` path or a
    // canonical asset URL both map under assetsDir (e.g. `/assets/animations/x.apng` →
    // `${assetsDir}/animations/x.apng`).
    const isDevicePath = url.startsWith('/') && !url.includes('/assets/');
    const path = isDevicePath ? url : join(this.assetsDir ?? '', assetsRelativeFromUrl(url));

    return (await FileSystem.getInfoAsync(toUri(path))).exists ? path : null;
  };

  override getBuildPath = async (dir: string): Promise<string> => {
    const full = join(this.buildDir ?? '', dir);
    await FileSystem.makeDirectoryAsync(toUri(full), { intermediates: true }).catch(() => {});

    return full;
  };

  override getSource = (segmentName: string | undefined): string => {
    const name = segmentName ?? this.segmentName;

    return name ? join(this.assetsDir ?? '', 'videos', `${name}.mp4`) : '';
  };

  override getDestination = (): string => join(this.buildDir ?? '', `${this.segmentName}_output.mp4`);

  override stat = async (filePath: string): Promise<boolean> => {
    const info = await FileSystem.getInfoAsync(toUri(filePath));

    return info.exists;
  };

  override fetch = async (url: string): Promise<string> => {
    // A unique temp name per download: two requests for one font face in a section fetch the same URL
    // concurrently, and a shared file would be truncated under the first download.
    const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const dest = join(this.tempDir, `${unique}-${basename(url)}`);

    if (url.startsWith('http://') || url.startsWith('https://')) {
      await FileSystem.downloadAsync(url, toUri(dest));

      return dest;
    }

    // Local staged media (descriptor-provided path) — copy into temp.
    await FileSystem.copyAsync({ from: toUri(url), to: toUri(dest) });

    return dest;
  };

  override read = async (filePath: string): Promise<string> => FileSystem.readAsStringAsync(toUri(filePath));

  override readFile = async (filePath: string): Promise<Uint8Array> => {
    const b64 = await FileSystem.readAsStringAsync(toUri(filePath), {
      encoding: FileSystem.EncodingType.Base64,
    });

    return base64ToBytes(b64);
  };

  override write = async (targetPath: string): Promise<void> => FileSystem.writeAsStringAsync(toUri(targetPath), '');

  override writeFile = async (path: string, data: Uint8Array): Promise<void> =>
    FileSystem.writeAsStringAsync(toUri(path), bytesToBase64(data), {
      encoding: FileSystem.EncodingType.Base64,
    });

  override append = async (targetPath: string, content: string): Promise<void> => {
    // expo-file-system has no append; read-modify-write (the only caller is the small concat list).
    const existing = (await FileSystem.getInfoAsync(toUri(targetPath))).exists
      ? await FileSystem.readAsStringAsync(toUri(targetPath))
      : '';

    await FileSystem.writeAsStringAsync(toUri(targetPath), existing + content);
  };

  override unlink = async (filePath: string): Promise<void> =>
    FileSystem.deleteAsync(toUri(filePath), { idempotent: true });

  override copy = async (sourcePath: string, targetPath: string): Promise<void> =>
    FileSystem.copyAsync({ from: toUri(sourcePath), to: toUri(targetPath) });

  override move = async (sourcePath: string, targetPath: string): Promise<void> =>
    FileSystem.moveAsync({ from: toUri(sourcePath), to: toUri(targetPath) });

  // Forwards `headers` (the font resolver's legacy User-Agent — both OkHttp and NSURLSession honour
  // it) and rejects on an HTTP error like the Node adapter does, instead of handing an error page
  // over as if it were CSS.
  override fetchAndRead = async (url: string, headers?: Record<string, string>): Promise<string> => {
    const response = await fetch(url, headers ? { headers } : undefined);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    return response.text();
  };
}

export default FilesystemExpoAdapter;
