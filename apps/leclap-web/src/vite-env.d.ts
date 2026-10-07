/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the compile server (`/compile`, `/templates`, `/health`). Defaults to the local dev server. */
  readonly VITE_API_URL?: string;
  /** '1' lets a production build load the WebMCP polyfill behind `?webmcp=polyfill` (dev builds always can). */
  readonly VITE_WEBMCP_POLYFILL?: string;
  /** '0' removes the browser-agent (WebMCP) tools from the builder entirely. */
  readonly VITE_WEBMCP?: string;
  /** Chrome's WebMCP origin-trial token; when set, the build injects its meta tag (vite/webmcp-origin-trial.ts). */
  readonly VITE_WEBMCP_OT_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
