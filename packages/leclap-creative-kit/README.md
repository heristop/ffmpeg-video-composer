# @leclap/creative-kit

**The shared LeClap creative catalog** — the templates, partials, fonts, media, and bundled assets every LeClap surface renders from.

Private to the monorepo (`workspace:*`, not published). The core engine ([`ffmpeg-video-composer`](../ffmpeg-video-composer)) stays content-free; this package is where the _content_ lives, so the server, MCP, web, and Expo apps draw from the same authored descriptors and assets. Encoder and filter capabilities vary by platform; output pixels are not identical across hosts.

Descriptors control scene timing, orientation, fps and creative direction. The host supplies paths, fields, clip bindings and encoder settings through `ProjectConfig`; registered effects additionally need the trusted Node renderer configured at MCP startup. See [engine configuration](../../docs/engine-configuration.md) for these boundaries and defaults.

## What it exports

| Import                                           | Provides                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `@leclap/creative-kit`                           | `APP_TEMPLATES`, `APP_TEMPLATES_BY_ID` — the catalog of ready-made template descriptors. |
| `@leclap/creative-kit/partials`                  | `expandPartials` / `expandPartialsSafe` + the generated partial registry.                |
| `@leclap/creative-kit/fonts`                     | `FONTS` — the bundled font set (BebasNeue, Oswald, …) used for text overlays.            |
| `@leclap/creative-kit/media`                     | Curated music/background metadata.                                                       |
| `@leclap/creative-kit/editor`                    | The visual-builder editor model (`toEditorState` / `buildDescriptor`, `MediaChoice`, …). |
| `@leclap/creative-kit/templates/*`, `/library/*` | Raw template JSON and the media/font files themselves.                                   |

## Layout

```
src/
  templates/      one JSON per catalog template (fast-curious, quote, spotlights, …)
  partials/       reusable section fragments (logo-bumper, flash-card, …)
  library/        the actual asset files — videos/ musics/ pictures/ fonts/ backgrounds/ animations/
  editor/         builder model: descriptor ⇄ editor-state mapping
  *.generated.ts  codegen indexes (templates.generated.ts, partials.generated.ts) — do not edit by hand
```

## Working in it

```bash
pnpm --filter @leclap/creative-kit gen:templates   # rebuild templates.generated.ts after adding a JSON
pnpm --filter @leclap/creative-kit gen:partials    # rebuild partials.generated.ts after adding a partial
```

`scripts/copy-core-assets.ts` (run on dev/build) stages `src/library/*` into each app's static dir, so the web/Expo apps serve the same media the engine renders with — the generated copies are git-ignored.

---

Part of the [LeClap monorepo](../../README.md). Template authoring reference: [Template Configuration](../../docs/template-configuration.md).
