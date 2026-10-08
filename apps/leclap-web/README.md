# @leclap/web — LeClap web

React 19 + Vite + Tailwind web app for LeClap. It compiles native JSON scenes **entirely in the browser** via WebAssembly FFmpeg, rendering the same [`@leclap/creative-kit`](../../packages/leclap-creative-kit) templates as the mobile app and CLI. Inputs and intermediates consume WASM memory; the approximate 2 GB input ceiling is not a supported project-size guarantee.

## Engine configuration

The browser host binds media/form values and supplies optional video, encoder-preset and quality-tier
overrides through `ProjectConfig`. Descriptor `global.orientation` resolves output dimensions and
`global.fps` wins over host fps. WASM segments render serially and always validate descriptors.
`BrowserCompileOptions.loadFFmpegCore` configures the initial WASM load; this app serves its pinned
core locally, and the HTML layer rasteriser's WebAssembly too (`loadHtmlWasm`, staged under
`/html-engine/<version>/` by `scripts/stage-html-engine.ts`; it also draws the builder's live preview). Registered React effects use a separately configured Node/Remotion backend; the
browser can compose its output clips. The showcase plays pre-rendered samples and does not enable
that backend. See [engine configuration](../../docs/engine-configuration.md) for all defaults and limits.

Key features:

- **Guided builder** — step-by-step clip capture and form fill, then one-click compile.
- **Capture modes** — per-section source selection: front webcam, back webcam, screen capture (`getDisplayMedia`), or local file upload. Controlled by `captureMode` / `allowedCaptureModes` in the template descriptor.
- **Export panel** — after compile: download the MP4, copy a blob URL, or share via the Web Share API.
- **Visual template editor** — author and preview templates in-browser (admin route `/admin`).
- **First-run onboarding** — guided intro for new users.
- **Browser agents (WebMCP)** — the template builder registers 23 tools with the agent built into the browser: reads, undoable edits, and consequential actions (replace, sample, preview, save) confirmed in the page. An **Agent** drawer in the titlebar holds the on/off switch, "Ask before every edit" and the activity log with Undo. See [docs/webmcp.md](../../docs/webmcp.md).

## Run

```bash
pnpm install              # from the repo root
pnpm app:web              # dev server   (or: pnpm --filter @leclap/web dev)
```

No backend is required — the compile runs entirely in a Web Worker via `@ffmpeg/ffmpeg`.

## Notes

- **Build / preview** — `pnpm --filter @leclap/web build` then `... preview`.
- **Routing** — React Router; pages under `src/presentation/pages/` (Home, Builder, Templates, Doc, …).
- **Assets** — bundled media/fonts are staged from `@leclap/creative-kit` into `public/` on dev/build (git-ignored).
- **ffmpeg.wasm core** — served from the app's own origin, never a CDN: `scripts/stage-ffmpeg-core.ts` stages
  `@ffmpeg/core` into `public/ffmpeg-core/<version>/` on dev/build, with the wasm gzipped to fit Cloudflare Pages'
  25 MiB file limit. The trim/crop pass and the engine both load it (`src/infrastructure/ffmpeg-core.ts`), and the
  service worker keeps it for offline use. Bumping it means bumping the engine's `FFMPEG_CORE_VERSION` too.

## Browser agents (WebMCP)

The builder registers its tools on `document.modelContext` only when the browser provides it (Chrome's
origin trial, or `chrome://flags/#enable-webmcp-testing`). The tool layer is a lazy chunk loaded on idle,
never with the entry (`tests/webmcp-bundle.test.ts` checks a production build).

| Setting                | Effect                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?webmcp=polyfill`     | Dev and e2e only: loads the WebMCP polyfill when the browser has no native API. Allowed in a dev build or one built with `VITE_WEBMCP_POLYFILL=1`; a production build never contains it. |
| `VITE_WEBMCP_OT_TOKEN` | Build-time origin-trial token; every page gets the trial's `<meta http-equiv="origin-trial">` tag (`vite/webmcp-origin-trial.ts`). Unset, no tag is added.                               |
| `VITE_WEBMCP=0`        | Removes the feature from the build.                                                                                                                                                      |
| `Permissions-Policy`   | `public/_headers` sends `tools=(self)`, so only this origin's frames can register tools.                                                                                                 |

### End-to-end tests

The Playwright suite reuses a running dev server at `E2E_BASE_URL` (default `http://localhost:5174`), so
start one there (`pnpm --filter @leclap/web dev --port 5174`) or point `E2E_BASE_URL` at yours. Set
`E2E_CHROMIUM_PATH` to use a preinstalled Chromium when `playwright install` is not available. `e2e/webmcp-builder.spec.ts` drives the builder through `?webmcp=polyfill` and its
`navigator.modelContextTesting` shim, without WASM by default:

```bash
pnpm --filter @leclap/web exec playwright test e2e/webmcp-builder.spec.ts
E2E_WASM=1 pnpm --filter @leclap/web exec playwright test e2e/webmcp-builder.spec.ts   # adds render_preview / render_frames
```

## Deploy — Cloudflare Pages (leclap.dev)

The app is a static SPA, so deployment is "build, then upload `dist/`". It compiles video with
FFmpeg WASM, which needs **cross-origin isolation** — `public/_headers` sets the required
`COOP`/`COEP`/`CORP` headers in production (mirroring `vite.config.ts`'s dev server); Vite copies it
into `dist/` and Pages reads it. There is no `_redirects` file: Pages already serves `index.html`
for unmatched paths, so the SPA fallback needs no configuration.

```bash
# one-time: register leclap.dev in Cloudflare, then authenticate + create the project
pnpm dlx wrangler login
pnpm dlx wrangler pages project create leclap --production-branch main

# build and deploy (run from the repo root)
pnpm --filter @leclap/web build
pnpm dlx wrangler pages deploy apps/leclap-web/dist --project-name=leclap
```

Bind the custom domain in the Cloudflare dashboard → Pages → **leclap** → Custom domains
(`leclap.dev`). `.dev` is HSTS-preloaded (HTTPS-only); Cloudflare provisions TLS automatically.

**Verify after deploy:** open DevTools on the live URL, confirm the document response carries the
`Cross-Origin-Opener-Policy`/`Embedder-Policy` headers and `crossOriginIsolated === true`, then run
a compile end-to-end and hard-refresh a deep link (e.g. `/templates`) to confirm SPA routing.

### Social card

`public/og-image.jpg` (1200×630, the 1.91:1 ratio link previews use, referenced by `index.html`/`Seo.tsx`)
and the repo's GitHub social preview (`.github/media/social-preview.png`, 1280×640) are the same card —
Clappy beside the wordmark — rendered from the Remotion composition: regenerate both with `pnpm render:og`
in the private leclap-brand-motion repo. The GitHub one is uploaded by hand, in the repo's Settings → Social
preview (there is no API for it).

---

Part of the [LeClap monorepo](../../README.md). MIT licensed.
