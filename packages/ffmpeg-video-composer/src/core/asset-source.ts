// Bundled fonts and music are no longer shipped inside the package (it would add ~106 MB). When a
// template references a catalog font (by registry id) or a track by name with no explicit url, the
// engine fetches the file on demand from the public LeClap repository. The base URL is overridable
// via `FVC_ASSET_BASE_URL` so a consumer can point at a mirror, a pinned tag, or a local server.
//
// The catalog media (.mp3/.mp4/large .png) are Git-LFS tracked. `raw.githubusercontent.com` serves the
// LFS *pointer* (a ~130-byte text stub), which would download as a broken file — so we use the
// `github.com/<owner>/<repo>/raw/<ref>/<path>` form, which redirects LFS objects to
// `media.githubusercontent.com` and serves the real binary (and still works for non-LFS fonts/LUTs).
const DEFAULT_ASSET_BASE_URL = 'https://github.com/heristop/leclap/raw/main/packages/leclap-creative-kit/src/library';

export function assetBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const base = env.FVC_ASSET_BASE_URL?.trim();

  return (base && base.length > 0 ? base : DEFAULT_ASSET_BASE_URL).replace(/\/+$/, '');
}

export function fontAssetUrl(file: string, env?: Record<string, string | undefined>): string {
  return `${assetBaseUrl(env)}/fonts/${file}`;
}

export function musicAssetUrl(file: string, env?: Record<string, string | undefined>): string {
  return `${assetBaseUrl(env)}/musics/${file}`;
}

export function sfxAssetUrl(file: string, env?: Record<string, string | undefined>): string {
  return `${assetBaseUrl(env)}/sfx/${file}`;
}

// Resolve a catalog-relative reference (e.g. `videos/outro.mp4`, `pictures/logo.png`,
// `animations/light_leak.apng`) to a remote URL under the public library. Descriptors carry the
// subdir in the path already, so we just prefix the base (and trim any leading slash so it doesn't
// double up). Used by the Node fetch adapter and the project_video demo-clip staging.
export function catalogAssetUrl(relativePath: string, env?: Record<string, string | undefined>): string {
  return `${assetBaseUrl(env)}/${relativePath.replace(/^\/+/, '')}`;
}

// The public library's top-level dirs: only a reference under one of them can be served by the catalog.
const CATALOG_DIRS = new Set([
  'animations',
  'backgrounds',
  'covers',
  'emoji',
  'fonts',
  'musics',
  'pictures',
  'sfx',
  'videos',
]);

// Whether a reference is catalog-relative (`pictures/logo.png`). Anything else without a scheme — `bg.png`,
// `./bg.png`, `~/bg.png`, an absolute path — is a local path, which a remote fetch can never satisfy.
export function isCatalogAssetPath(ref: string): boolean {
  const segments = ref.split('/');

  return segments.length > 1 && CATALOG_DIRS.has(segments[0]) && !segments.includes('..');
}

// A catalog path with no local copy that the catalog could not serve either: the network's own error (a
// 404, a proxy's certificate) alone hides that the file was first looked for in the assets dir.
export function catalogMissError(ref: string, remote: string, assetsDir: string | undefined, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);

  return new Error(
    `"${ref}" is not in the assets dir (${assetsDir ?? 'unset'}) and the asset catalog could not serve it (${remote}): ${reason}`
  );
}
