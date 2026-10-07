// Bundled font bytes for the browser agent's render-free geometry advisories: the same /fonts copies the
// WASM render preloads, fetched once per file and cached for the page's lifetime. A missing or failed
// font resolves null, which the geometry check reads as "measure approximately and say so".
const cache = new Map<string, Promise<Uint8Array | null>>();
const SAFE_FILE = /^[\w.-]{1,120}\.(?:ttf|otf)$/i;

async function fetchFont(file: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(`/fonts/${file}`);

    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export function loadBundledFont(file: string): Promise<Uint8Array | null> {
  if (!SAFE_FILE.test(file)) return Promise.resolve(null);

  let pending = cache.get(file);

  if (!pending) {
    pending = fetchFont(file);
    cache.set(file, pending);
  }

  return pending;
}
