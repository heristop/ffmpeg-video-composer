---
name: monorepo-dev-workflow
description: Use when building, testing, linting, formatting, typechecking, or running any app or package in the ffmpeg-video-composer monorepo, or when looking for the right pnpm/vp command.
---

# Monorepo Dev Workflow

## Overview

pnpm workspaces (`apps/*`, `packages/*`, plus `examples/llm-remotion-title`), no turbo/nx. Tooling is **vite-plus (`vp`)** — it provides lint (oxlint), format, test (vitest), and staged checks. There is **no eslint, no prettier, and no jest at the root** (jest lives only inside `apps/leclap-expo`).

- **pnpm 12.6.0**, **Node ≥ 24.11.0** (`engine-strict` — wrong versions are rejected). Install: `pnpm install`.

## Command map

| Task                    | Command                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Lint                    | `pnpm lint`                                                                                              |
| Format / check          | `pnpm fmt` · `pnpm fmt:check`                                                                            |
| Format/lint/type checks | `pnpm check`                                                                                             |
| Package tests           | `pnpm test` (recursive; Vitest packages + Expo Jest)                                                     |
| Build                   | `pnpm build` (recursive; tsdown libraries/CLI/MCP + Vite web app)                                        |
| Typecheck a package     | `pnpm --filter <pkg> exec tsc --noEmit`                                                                  |
| Perf bench / profile    | `pnpm --filter ffmpeg-video-composer bench` · `FVC_PERF=1 pnpm compile <t.json>` (`docs/performance.md`) |
| Run Expo app            | `pnpm app:expo` · `app:ios` · `app:android`                                                              |
| Run web app             | `pnpm app:web`                                                                                           |
| Build executables       | `pnpm build:exe:all`                                                                                     |
| Dep graph / check       | `pnpm deps:graph` (requires Graphviz `dot`) · `pnpm deps:check`                                          |

`<pkg>` names: `ffmpeg-video-composer`, `@leclap/cli`, `@leclap/mcp`, `@leclap/creative-kit`, `@leclap/expo`, `@leclap/web`, `leclap-json-effects-example`.

## Scope and prerequisites

- `pnpm test:ui`, `pnpm test:coverage`, and `pnpm test:ci` use the root Vitest config, which covers core, MCP, and repo-level tests. They omit CLI, creative-kit, web, and Expo package suites. `pnpm test` runs workspace packages' own test scripts; it does not collect repo-level `tests/`.
- CI runs root coverage, web/Expo/CLI tests separately, and `pnpm test:integration` for core/MCP Cucumber real renders. Rust tests run in a separate host-engine job; web Playwright tests are a separate `pnpm --filter @leclap/web test:e2e` command.
- Web Playwright tests reuse a dev server at `E2E_BASE_URL` (default `http://localhost:5174`); `E2E_CHROMIUM_PATH` points at a preinstalled Chromium. The browser-agent (WebMCP) suite runs without WASM through the dev polyfill: `pnpm --filter @leclap/web exec playwright test e2e/webmcp-builder.spec.ts`; `E2E_WASM=1` adds the preview and frame cases. See `docs/webmcp.md`.
- `pnpm check` checks formatting/lint/types; tests and builds are separate. `pnpm build` includes the web app's media fetch/staging and prerender, but does not build Expo or the Rust engine. Filter the affected package for a narrower build.
- Fresh-checkout lint needs generated imports: run `pnpm --filter ffmpeg-video-composer build` and `node scripts/copy-core-assets.ts` first (the CI prepare step). Dev `pnpm compile` / `pnpm diagnose` also import the core's built `dist`.
- Render/probe tests require real media and FFmpeg with `drawtext` plus `ffprobe`. CI uses `scripts/ci/fetch-test-media.sh` and verifies its allowlist; Git LFS pointer files alone are not valid test media. See `.github/workflows/ci.yml` for the current setup.

## Before committing

1. `pnpm fmt` — format (semicolons, single quotes, width 120, 2-space, trailing comma es5).
2. `pnpm lint` — oxlint must be clean.
3. `pnpm test` for affected code; `tsc --noEmit` on the package you changed.

Git hooks run `vp` staged checks automatically (`fmt` on most files, `lint` on `*.{ts,tsx}`), but run them yourself first to avoid hook failures.

## Common mistakes

- Reaching for `eslint`/`prettier`/`jest` configs at the root — they don't exist; use `vp` / the table above.
- Running raw `tsc` without `--filter`/`-p` — typecheck per package.
- Ignoring `engine-strict` — install fails on the wrong Node version; switch Node (e.g. via `mise`/`nvm`) rather than forcing the install.
