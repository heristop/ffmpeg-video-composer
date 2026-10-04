# @leclap/web — LeClap web

React 19 + Vite + Tailwind web app for LeClap. It compiles native JSON scenes **entirely in the browser** via WebAssembly FFmpeg, rendering the same [`@leclap/creative-kit`](../../packages/leclap-creative-kit) templates as the mobile app and CLI. Inputs and intermediates consume WASM memory; the approximate 2 GB input ceiling is not a supported project-size guarantee.

## Engine configuration

The browser host binds media/form values and supplies optional video, encoder-preset and quality-tier
overrides through `ProjectConfig`. Descriptor `global.orientation` resolves output dimensions and
`global.fps` wins over host fps. WASM segments render serially and always validate descriptors.
`BrowserCompileOptions.loadFFmpegCore` configures the initial WASM load; this app serves its pinned
core locally. Registered React effects use a separately configured Node/Remotion backend; the
browser can compose its output clips. The showcase plays pre-rendered samples and does not enable
that backend. See [engine configuration](../../docs/engine-configuration.md) for all defaults and limits.

Key features:

- **Guided builder** — step-by-step clip capture and form fill, then one-click compile.
- **Capture modes** — per-section source selection: front webcam, back webcam, screen capture (`getDisplayMedia`), or local file upload. Controlled by `captureMode` / `allowedCaptureModes` in the template descriptor.
- **Export panel** — after compile: download the MP4, copy a blob URL, or share via the Web Share API.
- **Visual template editor** — author and preview templates in-browser (admin route `/admin`).
- **First-run onboarding** — guided intro for new users.

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
