// The WebMCP polyfill is a development and e2e aid, never part of a production page: it is only ever
// dynamically imported, and only when BOTH the build allows it (a dev build, or VITE_WEBMCP_POLYFILL=1)
// AND the page asks for it (`?webmcp=polyfill`, or the stored dev flag). In a production build the
// guard folds to `false`, so the import is dead code. The polyfill installs `document.modelContext` only
// when the browser has none, plus the `navigator.modelContextTesting` shim the e2e suite drives.

/** True in a build allowed to load the polyfill. */
export const POLYFILL_BUILD = import.meta.env.DEV || import.meta.env.VITE_WEBMCP_POLYFILL === '1';

export interface PolyfillRequest {
  buildAllows: boolean;
  /** `location.search`. */
  search: string;
  /** The stored dev flag (settings-store `polyfill`). */
  storedFlag: boolean;
}

/** Whether this page should load the polyfill. */
export function polyfillRequested({ buildAllows, search, storedFlag }: PolyfillRequest): boolean {
  if (!buildAllows) return false;

  return new URLSearchParams(search).get('webmcp') === 'polyfill' || storedFlag;
}

/** Loads and installs the polyfill; false when the build does not allow it or the import failed. */
export async function loadWebMcpPolyfill(): Promise<boolean> {
  if (!POLYFILL_BUILD) return false;

  try {
    const { initializeWebMCPPolyfill } = await import('@mcp-b/webmcp-polyfill');
    initializeWebMCPPolyfill({ installTestingShim: true });

    return true;
  } catch {
    return false;
  }
}
