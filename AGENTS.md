# AGENTS.md

Guidance for AI agents working in the **leclap** monorepo. This is the canonical, tool-agnostic agent guide. Read it first.

## Project overview

A template-based, cross-platform FFmpeg video composer. A JSON template describes a video's structure (sections, filters, music); the engine compiles it into a finished video. The same core runs on **Node.js**, in the **browser** (WebAssembly), and in **React Native**.

- High-level intro: [`README.md`](./README.md)
- Design system (brand, colors, typography): [`DESIGN.md`](./DESIGN.md)
- Architecture & design patterns: [`docs/architecture.md`](./docs/architecture.md)
- Template JSON reference: [`docs/template-configuration.md`](./docs/template-configuration.md); what each option looks like: [`docs/gallery.md`](./docs/gallery.md) (snapshot sheets, regenerate with `bash docs/gallery/make-gallery.sh`)
- Registered effect contracts, custom catalogs and authoring workflow: [`docs/effects-configuration.md`](./docs/effects-configuration.md) (regenerate tables with `pnpm docs:effects`).
- Engine configuration (ProjectConfig, env vars, encoder tiers): [`docs/engine-configuration.md`](./docs/engine-configuration.md)
- Browser agents in the web builder (WebMCP tools, confirmations, security): [`docs/webmcp.md`](./docs/webmcp.md)
- MCP runtime (media/output roots, trusted entry/catalog/browser, deadlines and cache): [`packages/leclap-mcp/README.md`](./packages/leclap-mcp/README.md#configuration)
- FFmpeg detection/fallback: [`docs/architecture.md`](./docs/architecture.md#cross-platform-support)

## Repository layout

pnpm workspaces (`apps/*`, `packages/*`, plus `examples/llm-remotion-title`); no turbo/nx. The repo root is a **private orchestrator** (`leclap`) holding only shared dev tooling and scripts — not a publishable package. The published artifacts are `ffmpeg-video-composer` (the engine), `@leclap/cli` (the `leclap` command), and `@leclap/mcp`; the rest is private.

| Path                             | Package                                   | What it is                                                                                                                           |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `.`                              | `leclap` _(private)_                      | Workspace root — shared tooling (`vp`, vitest) and orchestration scripts only.                                                       |
| `packages/ffmpeg-video-composer` | `ffmpeg-video-composer`                   | The composition library (programmatic API), Node + browser/WASM. The heart of the repo.                                              |
| `packages/leclap-cli`            | `@leclap/cli`                             | The `leclap` CLI (citty): `init` scaffolder, `render`, `diagnose`. Consumes `ffmpeg-video-composer`.                                 |
| `packages/leclap-mcp`            | `@leclap/mcp`                             | MCP server exposing the engine as agent-callable tools (schema/validate/compose/probe) over stdio. Consumes `ffmpeg-video-composer`. |
| `packages/leclap-creative-kit`   | `@leclap/creative-kit` _(private)_        | Shared templates, partials, fonts, media, and bundled assets.                                                                        |
| `examples/llm-remotion-title`    | `leclap-json-effects-example` _(private)_ | JSON effects / Remotion integration example; typechecked separately.                                                                 |
| `packages/ffmpeg-engine`         | _(cargo crate)_                           | Embedded FFmpeg engine (Rust + uniffi) for on-device compiles; built via `scripts/ffmpeg/`.                                          |
| `apps/leclap-expo`               | `@leclap/expo`                            | Expo / React Native app — on-device native-engine compiles, Tamagui UI _(reference)_.                                                |
| `apps/leclap-web`                | `@leclap/web`                             | React 19 + Vite + Tailwind web app — in-browser FFmpeg via WASM _(reference)_.                                                       |

The user-facing CLI is `@leclap/cli` (`leclap render|init|validate|samples|verify|snapshot|compare|timeline|style|beats|studio|diagnose`). The `compile`/`diagnose` monorepo dev scripts still live in `packages/ffmpeg-video-composer` (root `pnpm compile` / `pnpm diagnose` delegate to them).

## Setup

- **pnpm 12.6.0** (pinned via `packageManager`) and **Node ≥ 24.11.0** (`mise.toml` selects the Node 24 and pnpm 12 release lines; `engine-strict=true` rejects wrong versions).
- Install: `pnpm install` at the repo root.
- Node detects system FFmpeg, then `ffmpeg-static`; its detector's WASM branch requires `window` and is not a pure-Node fallback. Browser hosts use the separate WASM entry point. Installing system FFmpeg (e.g. via `mise`) is recommended for Node work, with `ffprobe` on PATH. The static adapter needs optional `ffprobe-static` or an existence-checked adjacent probe binary. See `docs/architecture.md`.

## Commands

Run from the repo root unless noted. Tooling is **vite-plus (`vp`)**.

| Task                    | Command                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| Lint (oxlint)           | `pnpm lint`                                                             |
| Format                  | `pnpm fmt` / check only: `pnpm fmt:check`                               |
| Format/lint/type checks | `pnpm check`                                                            |
| Package tests           | `pnpm test` (recursive; Vitest packages + Expo Jest)                    |
| Workspace builds        | `pnpm build` (recursive; library/CLI/MCP tsdown + web Vite build)       |
| Typecheck a package     | `pnpm --filter <pkg> exec tsc --noEmit`                                 |
| Perf bench              | `pnpm --filter ffmpeg-video-composer bench` (see `docs/performance.md`) |
| Run Expo app            | `pnpm app:expo` (also `app:ios` / `app:android`)                        |
| Run web app             | `pnpm app:web`                                                          |

`pnpm test:ui`, `pnpm test:coverage`, and `pnpm test:ci` use the root Vitest config: core, MCP, and
repo-level tests only. CI runs web, Expo, and CLI suites separately, then `pnpm test:integration`
(Cucumber core/MCP real renders). Neither `pnpm test` nor `pnpm build` builds/tests the Rust engine;
CI has a separate Rust job. `pnpm check` does not replace tests or builds.

Type-aware lint needs the core's built `dist` and staged app assets: on a fresh checkout, run
`pnpm --filter ffmpeg-video-composer build` and `node scripts/copy-core-assets.ts` first, as CI does.
The root build includes the web app's media fetch/staging and prerender steps; use a package filter
when only a library build is needed. The dev `compile`/`diagnose` scripts also import built core output.

## Architecture & patterns

- **Platform abstraction** — `PlatformBridge` (`packages/ffmpeg-video-composer/src/platform/PlatformBridge.ts`) selects adapters for the Node entry point; browser and React Native entry points register their adapters directly. Each capability has an `Abstract*` base and per-platform `*Adapter`s: FFmpeg, filesystem, logging, music, events.
- **Compilation flow** — `TemplateDirector` orchestrates: init → build sections → concat → apply music. Sections are created by `SegmentFactory` and rendered by `*Segment` classes; FFmpeg commands are assembled by the editor **managers** (asset/variable/map/filter/formatter).
- **On-device compilation (Expo)** — the app is fully local: it drives the same core through a native FFmpeg CLI engine (`packages/ffmpeg-engine` + `FFmpegDeviceAdapter`) instead of WASM/system FFmpeg. There is no compile server; templates come from `@leclap/creative-kit` and render on the phone. See [`docs/on-device-compilation.md`](./docs/on-device-compilation.md).
- **Dependency injection** — tsyringe. Classes use `@injectable()` / `@singleton()`; dependencies are resolved from `container`. Wiring happens in the entry points `packages/ffmpeg-video-composer/src/index.ts` (Node) and `packages/ffmpeg-video-composer/src/browser.ts` (browser/WASM), and `packages/ffmpeg-video-composer/src/reactnative.ts` (native).
- **Validation** — templates are validated with zod schemas in `packages/ffmpeg-video-composer/src/schemas/template.schemas.ts` via `services/TemplateValidator.ts`.

## Conventions

- **Naming** — PascalCase for classes and their files (`VideoEditor.ts`); `Abstract*` for base classes; `*Adapter` for platform implementations. camelCase for non-class files (`default.config.ts`).
- **Format** (enforced by `vp`): semicolons, single quotes, `printWidth: 120`, `tabWidth: 2`, `trailingComma: es5`.
- **Path alias** — `@/*` → `packages/ffmpeg-video-composer/src/*`.
- **Decorators** — DI/decorators require `reflect-metadata` to be imported once at the entry point.
- **React Compiler is enabled** in both apps, through Oxc's Rust port (`oxc-transform-react`) rather than the Babel plugin: `apps/leclap-web` via `vite/oxc-react-compiler.ts`, `apps/leclap-expo` via `metro/oxc-react-compiler-transformer.js`. Both are scoped to the app's own sources and leave JSX to the downstream pass. Don't add `useMemo`/`useCallback`/`React.memo` — the compiler memoizes automatically.
- **Tests** — core Vitest tests live in `packages/ffmpeg-video-composer/tests/`; Cucumber integration scenarios live in its `features/`. Other packages and the web app own their Vitest configs; Expo uses its own Jest unit config. See the command boundaries above.
- Prefer reusing existing managers/adapters/factories over adding new abstractions; follow the patterns already in `packages/ffmpeg-video-composer`.

### Design system & styling (web — `apps/leclap-web`)

- **The design system is shadcn/ui + Radix** — utility-first, not BEM. Primitives live in `src/presentation/components/ui/` as shadcn-style components: Radix primitives for behavior/accessibility, styled with Tailwind utility classes, variants via **`class-variance-authority` (cva)**, classes merged with **`cn()`** (`@/lib/utils`, clsx + tailwind-merge). Add components via the shadcn CLI/registry; config in `components.json`.
- **Brand integration:** shadcn's CSS-variable contract (`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--border`, `--ring`, `--card`, …) is mapped onto the OKLCH brand tokens in `@theme` / `.dark` (`src/index.css`) so every shadcn primitive renders on-brand (lavender `--primary`, etc.). Never hard-code colors — reference tokens.
- **Tokens & theme:** OKLCH CSS variables in `@theme` (`src/index.css`); light is the default, `.dark` on `<html>` swaps semantic surface/text tokens; brand/secondary/accent ramps are theme-constant.
- **Dependencies:** Radix is added per primitive (`@radix-ui/react-*`) plus `class-variance-authority`; pin versions old enough to satisfy the `minimumReleaseAge` supply-chain policy (`pnpm-workspace.yaml`).
- **Path alias** in the web app: `@/*` → `apps/leclap-web/src/*` (distinct from core's `@/*`).

### Motion effects (engine `fx` primitives)

- The 13 `graphics[].type: "fx"` primitives are documented in [`docs/template-configuration.md`](./docs/template-configuration.md#light-and-effects-graphicstype-fx). Adding one follows the extension contract at the top of `packages/ffmpeg-video-composer/src/editor/presets/fx.ts`: a row in `FX_PRIMITIVES` (`schemas/fx-primitives.schemas.ts`), its prose in `FX_DOCS` (`schemas/fx-docs.ts`), a lowering module `editor/presets/fx-<name>.ts` (on-device filters only, with a fallback), one line in `fx-registry.ts`, and an entry in `tests/lgpl-filter-audit.test.ts`.
- Review motion visually, not only through goldens: `pnpm motion:review` renders every effect fixture (`scripts/motion-review/fixtures/`) and bundled template as contact sheets with a before/after `index.html` (see [`scripts/motion-review/README.md`](./scripts/motion-review/README.md)).
- After changing an effect's defaults or the builder's animation library, regenerate the picker thumbnails with `pnpm gen:animation-thumbs` (plain blobs under `packages/leclap-creative-kit/src/library/animation-thumbs/`).

### Browser-agent tools (web — WebMCP)

- The builder's 23 WebMCP tools live in `apps/leclap-web/src/application/usecases/webmcp/` and reach the builder only through `BuilderPort`; names and kinds are in `tool-names.ts`. Keep the tool layer free of React, AI keys and media storage.
- Adding, renaming or re-classifying a tool means updating `src/presentation/components/doc/webmcpDocs.ts` (checked by `webmcpDocs.test.ts`), the `agent.json` locales and `docs/webmcp.md`. Names shared with `@leclap/mcp` (`SHARED_WITH_MCP`) must keep the same meaning on both surfaces.
- Consequential actions always go through the in-page confirmation queue; never add a tool that films, uploads media or downloads exports.

## Pre-commit

Git hooks run via vite-plus staged checks (`vp fmt` on `*.{ts,tsx,js,cjs,mjs,json,md,yml,yaml}`, `vp lint` on `*.{ts,tsx}`). Keep changes formatted (`pnpm fmt`) and lint-clean before committing.

## Skills

Repo-specific skills live in [`.agents/skills/`](./.agents/skills/). Load the matching one when its trigger applies:

- **authoring-video-templates** — creating/editing template JSON, sections, filters, maps, variables, or fixing validation errors. Compose motion with the motion engine; the library animations are samples, not building blocks.
- **core-architecture-patterns** — adding a segment type, platform adapter, or core service in `packages/ffmpeg-video-composer`.
- **monorepo-dev-workflow** — building, testing, linting, formatting, or running any app/package.
- **cross-platform-ffmpeg** — working across Node/Static/WASM FFmpeg, the PlatformBridge, or browser/RN constraints.
- **ondevice-ffmpeg-engine** — building/modifying/consuming the on-device engine (`packages/ffmpeg-engine` + the `leclap-ffmpeg` native module), the `run`/`probe`/`cancel` API, uniffi bindings, or `scripts/ffmpeg`.

## Gotchas

- Browser assets live in IndexedDB but are copied into FFmpeg's in-memory MEMFS. The approximate **2 GB** input ceiling is not a supported project-size guarantee: inputs and intermediate copies can exhaust WASM memory earlier.
