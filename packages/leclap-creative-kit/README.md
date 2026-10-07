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
| `@leclap/creative-kit/sfx`                       | `SFX_ITEMS` — the bundled sound effects (path and license) for section and global `sfx`. |
| `@leclap/creative-kit/music-beats`               | `findMusicBeats` — precomputed beat grids and drop cues of the library tracks.           |
| `@leclap/creative-kit/editor`                    | The visual-builder editor model (`toEditorState` / `buildDescriptor`, `MediaChoice`, …). |
| `@leclap/creative-kit/templates/*`, `/library/*` | Raw template JSON and the media/font files themselves.                                   |

## Layout

```
src/
  templates/      one JSON per catalog template (fast-curious, quote, spotlights, …)
  partials/       reusable section fragments (logo-bumper, flash-card, …)
  library/        the actual asset files — videos/ musics/ pictures/ fonts/ backgrounds/ animations/ emoji/
  editor/         builder model: descriptor ⇄ editor-state mapping
  *.generated.ts  codegen indexes (templates.generated.ts, partials.generated.ts) — do not edit by hand
```

## Working in it

```bash
pnpm --filter @leclap/creative-kit gen:templates   # rebuild templates.generated.ts after adding a JSON
pnpm --filter @leclap/creative-kit gen:partials    # rebuild partials.generated.ts after adding a partial
pnpm --filter @leclap/creative-kit gen:sfx         # regenerate the bundled sound effects
pnpm --filter @leclap/creative-kit gen:music-beats # re-measure the library tracks' beat grids
pnpm --filter @leclap/creative-kit gen:music-covers # redraw the music cover art (library/covers)
```

`library/sfx/` holds 33 original sound effects (whoosh, swoosh-short, hit, boom, riser, click, tick, pop, shutter, ding, glitch, sparkle, thud, zap, notification, keystroke, blip, rise-short, coin, drum-roll, heartbeat, clap, snap, success, error, swoosh-long, sub-drop, reverse-cymbal, water-drop, whistle-up, camera-focus, paper, tada), synthesized by `pnpm --filter @leclap/creative-kit gen:sfx` (pass ids to regenerate only those); regenerating with the same FFmpeg build writes identical bytes. `gen:music-beats` measures every library track into `src/music-beats.generated.json` (needs `git lfs pull` and a built engine first). `library/covers/` holds one 512x512 WebP cover per library track (`<id>.webp`), drawn as SVG scenes in `scripts/music-covers-*.ts` and rendered in Playwright Chromium by `gen:music-covers` (`--only id,id` redraws a few). `library/fonts/` includes Noto Sans Arabic and Hebrew (`noto-arabic`, `noto-hebrew`, OFL) for right-to-left copy.

`library/emoji/` holds the colour emoji the engine composites over drawn text (72x72 PNGs named by code-point sequence, e.g. `1f44d-1f3fd.png`). They are rendered from [Twemoji](https://github.com/jdecked/twemoji) — © Twitter, Inc, jdecked and other contributors, licensed [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). Regenerate the set (and the engine's `src/core/emoji-manifest.generated.ts`) with `pnpm gen:emoji`; edit the list in `scripts/gen-emoji.ts`.

`scripts/copy-core-assets.ts` (run on dev/build) stages `src/library/*` into each app's static dir, so the web/Expo apps serve the same media the engine renders with — the generated copies are git-ignored.

---

Part of the [LeClap monorepo](../../README.md). Template authoring reference: [Template Configuration](../../docs/template-configuration.md).
