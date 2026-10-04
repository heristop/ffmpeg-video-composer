<div align="center">

<img src=".github/media/clappy.png" alt="Clappy, the LeClap mascot" width="126" height="120" />

# LeClap

**Deterministic, on-device, agent-callable video — composed by prompt or by hand.**

Describe a video in one JSON _template_ — sections, filters, music, overlays — then render **that same template** on a phone (React Native, **on-device**) or in the **browser** (WebAssembly). No upload, no server, no generative model: the render is deterministic and reproducible, not sampled.

[![CI](https://github.com/heristop/leclap/actions/workflows/ci.yml/badge.svg)](https://github.com/heristop/leclap/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D24.11.0-brightgreen.svg)](https://nodejs.org/en/)
[![pnpm](https://img.shields.io/badge/pnpm-12-f69220.svg)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Trademark: LeClap](https://img.shields.io/badge/™-LeClap-blue.svg)](TRADEMARK.md)

[Quick start](#-quick-start) · [Templates](docs/template-configuration.md) · [Library API](packages/ffmpeg-video-composer/README.md) · [Architecture](docs/architecture.md) · [Docs](#-documentation)

</div>

---

## ✨ What is LeClap?

One JSON template. It renders on Node, in the browser via WebAssembly, and **natively on-device on React Native** — same template, same pipeline, reproducible run after run on a given platform. No upload, no server, no generative model.

## 🎥 Demo

https://github.com/user-attachments/assets/e5e6f7a1-3c84-479b-b6d7-83209e83017d

## 🤔 Why LeClap?

Generative tools can't reproduce a result twice. Cloud renderers can't run in your user's pocket. Remotion renders without a server, but needs a browser engine to do it — LeClap links FFmpeg into the app itself.

|                                     |            **LeClap**             |             Remotion             |     Shotstack     |     Generative video     |
| ----------------------------------- | :-------------------------------: | :------------------------------: | :---------------: | :----------------------: |
| Renders in a native app, no browser | ✅ React Native, FFmpeg linked in |   ❌ needs a WebCodecs browser   |   ❌ cloud API    |       ❌ cloud API       |
| Runs with no server                 |                ✅                 | ✅ in the browser, since 4.0.491 |   ❌ cloud API    |       ❌ cloud API       |
| Same input → same output            |         ✅ per platform¹          |    ✅ if you avoid randomness    | ⚠️ not documented | ❌ sampled, not rendered |
| Authored by an AI agent             |              ✅ MCP               |   ⚠️ an LLM writes React code    |  ✅ MCP (cloud)   |        ✅ prompt         |

<sub>¹ Per platform, not across them: Node and the browser encode with libx264, Android with `libopenh264`, iOS with `h264_videotoolbox`, and the on-device build drops `boxblur` and rewrites `eq`→`lutyuv`. Same composition, different pixels.</sub>

**[LeClap vs Remotion →](https://leclap.dev/compare/remotion)** — the reasoning behind each row, the full caveats, every claim sourced to vendor docs, and when to pick Remotion instead.

## 🧰 Highlights

| Highlight                         | What it means                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 🧩 **Template-driven**            | One JSON descriptor → a complete video. No imperative FFmpeg wrangling.                                                                      |
| 🌍 **Runs everywhere**            | Node.js, browser (WASM), and React Native — one shared core, reproducible on each (the encoder differs per platform, see above).             |
| 📹 **Capture → compose → render** | Record from the camera, trim/crop, mix music, add transitions, and render — captured, edited, and composed on-device.                        |
| 🤖 **Agent-callable**             | An [MCP server](packages/leclap-mcp) lets an AI agent author & render a template — no LLM in the output path, so it's rendered, not sampled. |
| 🎨 **Premium out of the box**     | A bundled [creative kit](packages/leclap-creative-kit) of polished, on-device-safe templates — by prompt or in the visual builder.           |
| 🧱 **Typed & validated**          | Zod-validated templates, strict TypeScript, dependency-injected architecture.                                                                |

## 🎬 Don't describe the change. Show it.

LeClap can sit inside an agentic development loop. After implementing a change, an agent collects a short screen recording and a precise review focus, authors a reusable template, validates it, and renders a deterministic MP4. The resulting clip can be attached to a pull or merge request beside the diff, so the reviewer sees the behavior before digging into the implementation.

The workflow is explicit: **implement → collect evidence → author template → validate → render → attach to PR/MR**. LeClap creates the video artifact; the surrounding workflow decides when and where to upload it.

**[See the use case →](https://leclap.dev/#agentic)** · **[Run the example](examples/agentic-pr-video)** · **[Copy the agent skill](examples/agentic-pr-video/evidence-skill)**

## 🚀 Quick start

> 💡 **Recommended: [mise](https://mise.jdx.dev).** `mise install` provisions **Node 24, pnpm 12, FFmpeg 8.1.1, and stable Rust**. Node/pnpm release lines and Rust stable can advance; `packageManager` pins pnpm to **12.6.0**. Managing versions yourself? Bring **Node ≥ 24.11.0** and **pnpm 12.6.0**.

```bash
git clone https://github.com/heristop/leclap.git
cd leclap
mise install     # Node 24, pnpm 12, FFmpeg 8.1.1 + Rust
pnpm install
```

Build the shared core, then pick an app:

```bash
pnpm --filter ffmpeg-video-composer build
pnpm app:web      # web app — compiles videos in-browser (no server)
pnpm app:expo     # Expo mobile app — compiles fully on-device (no server)
```

Or use the CLI — [`@leclap/cli`](packages/leclap-cli) is the `leclap` dev tool:

```bash
npx @leclap/cli samples list          # discover the packaged showcase
npx @leclap/cli samples show web-app-promo
npx @leclap/cli samples export native-timing --output timing.json
npx @leclap/cli init my-video         # scaffold a starter project
npx @leclap/cli render template.json  # render it (`leclap diagnose` checks your FFmpeg)
```

Or drive it from an AI agent: the [`@leclap/mcp`](packages/leclap-mcp) server exposes the engine as MCP tools — sample discovery → customize → validate → render — with no LLM in the output path.

The installed CLI and MCP expose all **32 showcase samples** (22 native, 10 Remotion), including creative
direction and required clips, copy, fonts and assets. Exported descriptor JSON embeds referenced partials;
supply your own media before rendering. Registered Remotion effects require the configured MCP
Node/Chromium backend and, where indicated, a trusted operator catalog. Discovery itself needs neither
FFmpeg nor Remotion. See [CLI sample commands](packages/leclap-cli/README.md#samples--discover-and-adapt-a-showcase)
and [MCP discovery](packages/leclap-mcp/README.md#discover-samples-before-authoring).

## 📦 Monorepo

pnpm workspaces (`apps/*`, `packages/*`, plus `examples/llm-remotion-title`) — no turbo/nx. The root is a private orchestrator (`leclap`); `ffmpeg-video-composer`, `@leclap/cli`, and `@leclap/mcp` are published to npm. The web and mobile apps both run the same core — the mobile app drives it **fully on-device** via the embedded native engine (no server), the web app in-browser via WASM.

| Package                                                   | Description                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`ffmpeg-video-composer`](packages/ffmpeg-video-composer) | **The library** — cross-platform composition engine (Node, browser, WASM).       |
| [`@leclap/cli`](packages/leclap-cli)                      | **The CLI** — the `leclap` dev tool: scaffold (`init`), `render`, `diagnose`.    |
| [`@leclap/creative-kit`](packages/leclap-creative-kit)    | Shared creative catalog — templates, partials, fonts, media, bundled assets.     |
| [`@leclap/mcp`](packages/leclap-mcp)                      | MCP server — the engine as agent-callable tools (schema/validate/compose/probe). |
| [`@leclap/web`](apps/leclap-web)                          | React 19 + Vite + Tailwind — in-browser FFmpeg via WASM _(reference)_.           |
| [`@leclap/expo`](apps/leclap-expo)                        | Expo / React Native — on-device compiles via the native engine _(reference)_.    |
| [`ffmpeg-engine`](packages/ffmpeg-engine)                 | Rust engine embedding FFmpeg fftools for on-device compiles.                     |

## 🧩 Templates & library

A **template** is a Zod-validated JSON descriptor — a `global` block plus an ordered list of `sections`, each a clip with its own `inputs → maps → filters` pipeline and `{{ variable }}` placeholders. Start from a [creative-kit template](packages/leclap-creative-kit) and tweak text, colors, and media — by prompt (MCP) or in the visual builder.

- 📖 **[Template configuration reference](docs/template-configuration.md)** — global config, sections, the FFmpeg pipeline, placeholders.
- 📥 **[Use it as a library](packages/ffmpeg-video-composer/README.md)** — install, the `compile()` API, entry points (Node / browser / RN), and automatic FFmpeg detection.

## 📚 Documentation

- **[🌐 Descriptor reference (web)](https://leclap.pages.dev/doc)** — the full, schema-driven descriptor reference, one page per topic (sections, transitions, looks, grade, motion, audio, captions, filters, examples, JSON Schema).
- **[🧩 Template Configuration](docs/template-configuration.md)** — the template JSON reference.
- **[🎬 Effects Configuration](docs/effects-configuration.md)** — generated effect contracts, custom registration, bounds, assets and preview/edit workflow.
- **[⚙️ Engine Configuration](docs/engine-configuration.md)** — host `ProjectConfig`, CLI bindings, MCP flags, deadlines, cache and output precedence.
- **[🏗 Architecture](docs/architecture.md)** — system architecture and design patterns.
- **[🔧 FFmpeg Fallback Strategy](docs/architecture.md#cross-platform-support)** — how automatic FFmpeg detection works.
- **[📱 On-Device Compilation](docs/on-device-compilation.md)** — the serverless Expo compile pipeline.
- **[🤖 AGENTS.md](AGENTS.md)** — repo layout, commands, and conventions for contributors and AI agents.

### Creative direction

Record the visual brief in `meta.creativeDirection`, then implement it with explicit JSON settings or
registered Remotion props. The CLI starter and MCP authoring prompt accept the same direction.
See [the guide and distinct example treatments](docs/creative-direction.md).

## 🤝 Contributing & License

Issues and PRs welcome. Keep changes formatted (`pnpm fmt`) and lint-clean (`pnpm lint`) before committing. The code is licensed under the [MIT License](LICENSE).

**Brand & trademark.** The MIT License covers the code, not the brand. The **LeClap** name and logo are trademarks of Alexandre Mogère — you can fork and reuse the code freely, but please give your fork a different name and don't imply endorsement. See [TRADEMARK.md](TRADEMARK.md) for details.
