# @leclap/cli

The LeClap command-line tool — the **human-facing** way to scaffold a video project and render it
locally on the [`ffmpeg-video-composer`](https://github.com/heristop/leclap) engine. You
write a JSON `template.json`, drop media in `assets/`, and `render` it to an mp4. `init` exists to take a
new user from nothing to a first render in one command.

## Quick start

```bash
pnpm dlx @leclap/cli init my-video   # scaffold a starter project (prompts for MCP + Remotion)
cd my-video
pnpm install
pnpm render                          # runs the scaffolded `leclap render template.json` script
```

## Commands

```bash
leclap init [name]        # scaffold a starter project (template.json + assets/ + README + scripts)
leclap init --studio <dir> # scaffold a production folder (brief, style guide, shot list, gates)
leclap studio status [dir] # passed production gates and what the next one needs (also `studio pass <gate>`)
leclap render <template>  # compile a video from a template JSON
leclap validate <template> # check a template without rendering (schema + text layout)
leclap samples list       # discover showcase samples (also --category, --backend, --query, --json)
leclap samples show <id>  # inspect direction and requirements (also --json)
leclap samples export <id> # raw descriptor JSON to stdout (or --output <new-file>)
leclap verify <manifest>  # check a video against its render manifest (--rerender to re-render and compare)
leclap style <reference>  # derive a theme + style guide from an image or clip (--json, --out style-guide.md)
leclap beats <audio>      # tempo, beat grid, confidence and drop/build cues for global.beats (--json)
leclap snapshot <template> # render and save still frames (PNG) of chosen moments, contact sheets
leclap compare <a> <b>    # the same moment of several templates in one labelled grid
leclap timeline <template> # sections, motion events, beats and cues on video seconds (--json)
leclap diagnose           # check your FFmpeg setup and what it can render (--json for the report)
leclap --help             # usage (per-command help with `leclap <command> --help`)
leclap --version
```

`leclap <template.json>` is a shorthand for `leclap render <template.json>`.

`render` reads assets from `<cwd>/assets` and writes output under `<cwd>/build`.

## Render configuration

```bash
leclap render template.json \
  --assets ./assets --build ./build \
  --video demo=./clips/screen.mp4 \
  --field form_1_title="Your next release" \
  --locale en --orientation landscape --output ./exports/promo.mp4
```

Use the descriptor's effective section and field names. Repeat `--video` and `--field` to bind
multiple inputs; later values win for the same key. All relative file/directory paths resolve from
the working directory. `--orientation` overrides `template.global.orientation`, while frame rate
comes from `global.fps`. `--output` copies the finished video atomically after successful compilation,
and refuses a path that is the template or a `--video` clip.

Renders use the deterministic encoder profile by default (bit-exact muxing, pinned encoder threads):
the same template, assets and FFmpeg build always produce the same bytes. `--no-deterministic` turns
it off. `--manifest` writes `<output>.manifest.json` next to the video, with the template, asset,
filtergraph and output digests.

```bash
leclap render template.json --output out.mp4 --manifest
leclap verify out.mp4.manifest.json             # is out.mp4 still that render?
leclap verify out.mp4.manifest.json --rerender  # render the recorded template again; compare every digest
```

A template with [`formats`](../../docs/template-configuration.md#formats-one-story-several-compositions)
renders one composition with `--format landscape|portrait|square`, or several with `--formats`:

```bash
leclap render story.json --format portrait -o story-vertical.mp4
leclap render story.json --formats all -o story.mp4    # story-landscape.mp4, story-portrait.mp4, story-square.mp4
```

`--formats all` renders every declared format (or list them: `--formats landscape,portrait`), each to
`<output>-<format>.mp4` (`<template>-<format>.mp4` without `-o`). With `--json` it prints
`{ ok, outputs: [{ format, output, bytes }], durationMs }`. `--formats` ignores `--watch`.

`--qc` checks the finished file (duration, frame count, A/V drift, pixel format, colour tags, audio,
black and frozen frames, silence, loudness and true peak), prints a findings table and exits non-zero
when a check fails. `--cache <dir>` reuses sections whose command, inputs and FFmpeg build are
unchanged, so iterating on one scene re-encodes only that scene.

```bash
leclap render template.json --output out.mp4 --qc --cache .leclap-cache
```

`verify --rerender` takes `--assets`, `--build` and repeatable `--input section=path` for
`project_video` clips. It exits 1 on any mismatch and prints the first filtergraph command that
differs. Use `--json` for machine-readable checks.

Codec, quality tier and segment concurrency are configured through the library's `ProjectConfig`;
the published CLI has no flags for those fields. MCP server flags belong to `leclap-mcp`, not
`leclap render`. See [engine configuration](../../docs/engine-configuration.md) for all defaults,
platform constraints and environment-variable scope.

## `samples` — discover and adapt a showcase

The installed CLI includes the same 47 samples as the [web showcase](https://leclap.dev/showcase/):
37 native and 10 registered Remotion examples. Discovery and export work without a repository checkout,
FFmpeg or Remotion, and do not download media or render effects.

```bash
leclap samples list --category typography --backend remotion --query blur
leclap samples list --backend native --json
leclap samples show web-app-promo
leclap samples show editorial-blur-rise --json
leclap samples export web-app-promo --output app-demo.json
leclap samples export native-timing > timing.json
# Customize copy and supply media before validating and rendering:
leclap validate app-demo.json
leclap render app-demo.json
```

`list --json` returns a metadata array. `show --json` returns the selected metadata plus `template`.
`export` returns only the descriptor, with referenced partials embedded. `--output` creates a new file
and fails if that path exists. Unknown IDs or invalid category/backend filters exit 1 with a stderr
error; successful JSON stdout contains only JSON. Categories are `templates`, `typography`, `app-demos`,
`overlays` and `evidence`; backends are `native` and `remotion`.

Read `show` before rendering: it reports creative direction, project clip names/durations/capture hints,
form fields and copy limits, variable defaults/placeholders, asset references and setup requirements.
Supply your own media and fonts; preview videos/posters and showcase media are not shipped. Asset paths
remain authored references and must resolve in your configured assets directory or be replaced.
Effective font files from text presets are marked `source: "preset"`, with font family metadata when available.
For native samples needing project clips or form inputs, pass repeatable `--video section=path` and
`--field key=value` flags, or use the library's `userVideoPaths`/`fields` or MCP `compose_video` bindings.

Registered effect samples require MCP's opted-in Node/Chromium backend, Remotion peers and a trusted
configured entry that registers the named composition. Effects marked `customCatalog: true` additionally
need the operator's `--effect-catalog`; exporting JSON does not install that catalog or executable source.
The CLI does not render registered effect sections directly. See the [MCP setup](../leclap-mcp#operator-custom-effect-catalogs).

## `validate` — check before you render

`validate` checks a template against the schema without touching FFmpeg, then reads where the renderer
will draw every piece of text and warns about text that runs off the frame or out of title-safe,
collides with other text, sits under a band, is too small, lacks contrast, or sits over footage with no
box, outline or shadow. Each warning says what to change.

```bash
leclap validate template.json         # human report; exit 1 only for schema errors
leclap validate template.json --json  # { success, errors?, warnings? } for scripts and agents
```

Warnings never change the exit code, so `validate` is safe as a CI gate. At most 20 are shown, worst
first. Widths come from the real fonts; when a font is not bundled, `validate` fetches it from the
LeClap asset catalog (5s timeout) and, offline, falls back to an estimate marked `(approx: …)`.

The check above never sees a pixel, so text over a picture, a grade or a look can only be flagged for
lacking a box, outline or shadow. `--render` settles those: it renders the sections that hold text
through FFmpeg (twice, the second time with the glyphs recoloured to find them), reads one frame per
piece of text where it rests, and measures its contrast against the pixels around it.

```bash
leclap validate template.json --render         # seconds, not milliseconds; reads <cwd>/assets
leclap validate template.json --render --json  # adds { render: { measured, seconds, unavailable? } }
```

It needs a native FFmpeg with `drawtext` (`leclap diagnose`). It checks the FFmpeg it would render
with first — a build without libfreetype has no `drawtext` — and without one it reports the
render-free findings and says why it skipped. Text over a user recording (`project_video`) is not
measured — the recording does not exist yet — and over template footage one frame is only one
frame, so that finding keeps the render-free one beside it.

## `snapshot` — look at the result

`snapshot` renders a template (through the per-section cache, so a second look costs a copy, not an
encode) and saves still frames as PNGs. Moments are seconds or time references read on the whole
video: a section edge (`intro.end`), an element id (`title.end + 0.2`), `50%`, `end`, `beat:8`, `bar:2`,
`cue:drop`.

```bash
leclap snapshot template.json --at 1.5,intro.end      # explicit moments (comma-separated or repeated)
leclap snapshot template.json --at-transitions        # each cut, 0.1 s before and 0.2 s after
leclap snapshot template.json --per-section           # each section once its entrances have landed (default)
leclap snapshot template.json --at-transitions --sheet 3x2 --safe tiktok --out frames/
leclap snapshot template.json --at 4 --zoom 0.5,0,0.5,0.5   # crop x,y,w,h (fractions, or pixels)
leclap snapshot template.json --at 2 --looks          # the section at 2 s, once per LOOK preset, in one grid
leclap compare a.json b.json --at 3                   # the same moment of each template, labelled
leclap timeline template.json --json                  # where everything sits, without rendering
leclap snapshot template.json --format portrait       # one format of a template with `formats` (default: its own)
```

`--sheet COLSxROWS` tiles the frames into labelled contact sheets (time and section on each tile);
`--safe <platform>` shades that platform's UI zones in translucent red, so text hiding under the
caption block or the action buttons is obvious. `--cache <dir>` names the section cache (default: a
shared temp directory); `--json` prints every frame's path, time, section and size. Frames land in
`./frames` unless `--out` says otherwise.

## `style` — match a reference look

```bash
leclap style reference.mp4                       # roles, contrast, pacing and the global.theme snippet
leclap style poster.png --out style-guide.md     # also writes style-guide.md + style-guide.theme.json
leclap style reference.mp4 --json                # the full analysis: { theme, styleGuide, confidence }
```

FFmpeg decodes the reference into small frames (every 0.25 s for clips, at most 240). The palette is
clustered in OKLab and assigned to theme roles, with `fg` and `muted` moved to WCAG AA (4.5:1) on `bg`
when they fall short; clips add the average shot length, cuts per minute, motion energy and a
suggested genre. Only the palette, texture and pacing carry over — subjects, logos and text in the
reference are never copied. The same reference (and `--seed`) always gives the same theme.

## `beats` — measure a music track

```bash
leclap beats track.mp3                  # BPM, beat 1, confidence, build/drop/end cues and the global.beats block
leclap beats track.mp3 --json           # the full analysis, including every beat time
leclap beats waltz.mp3 --beatsPerBar 3  # bar length for the downbeat estimate (default 4)
```

Paste the printed `{ bpm, offset, beatsPerBar }` into `global.beats` and the drop into the `cues` of the
section playing at that moment. When the pulse is not reliable (calm or ambient music), pace by phrases
instead. A template can also ask the Node compile to measure its own track with
`global.beats: { "analyze": "music" }`; see [time references](../../docs/template-configuration.md#time-references).

## `studio` — a production folder

```bash
leclap init --studio launch-film        # brief.md, style-guide.md, shotlist.md, template.json, assets/, reviews/, out/, studio.json
leclap studio status launch-film        # passed gates with their time, the next gate and its missing artifacts
leclap studio pass assets-approved launch-film   # record a gate once its artifacts exist (--force to override)
```

The scaffolded `template.json` has one section per beat, each with a `purpose`, a `role` and a headline,
and sets `meta.brief`, so validation flags a section that loses its purpose. Gates pass in order:
assets-approved, style-approved, stills-checked, rough-cut, repaired, delivered. `--studio` refuses a
non-empty directory.

## `diagnose` — what your FFmpeg can render

`leclap diagnose` reports the FFmpeg it found and probes what that build can actually do (drawtext and
text shaping, LUTs, tone-mapping, blur, alpha masks, transitions, loudness, encoders), with a fix for each
missing feature. `leclap diagnose --json` prints the capability report; see
[FFmpeg capability probe](../../docs/engine-configuration.md#ffmpeg-capability-probe).

## `init` — scaffold a project

`init` writes a minimal, immediately-renderable project: a no-external-media `template.json` (so the
first `render` just works), `package.json`, `README.md`, `assets/`, and a `pnpm-workspace.yaml` whose
`allowBuilds` lets pnpm 11+ run the `ffmpeg-static` download (npm, yarn and bun ignore it). It then
**prompts** whether to also set up:

- **the MCP server** (default Yes) — adds a project-scoped `.mcp.json` wiring [`@leclap/mcp`](../leclap-mcp)
  so an AI agent can author + render in this project (see below);
- **a Remotion starter** (default Yes) — adds a self-contained `remotion/` project (an `Intro`
  composition) for animated intros, plus the deps the MCP needs to render it.

Skip the prompts with flags (handy for scripts / CI — prompts also auto-default in a non-TTY):

```bash
leclap init my-video --yes                 # accept all defaults (MCP + Remotion)
leclap init my-video --no-mcp --no-remotion # bare CLI-render starter only
leclap init my-video --mcp --no-remotion    # MCP wiring, no Remotion
```

## Creative direction

Every starter includes `meta.creativeDirection`, an editable visual brief describing its initial
composition. Supply your own when scaffolding:

```bash
leclap init demo --no-remotion --no-mcp \
  --creative-direction "Bold editorial. Dark ink, white type, restrained motion and a readable final hold."
```

The brief is plain text (1–4000 characters), validated with the descriptor and preserved by the editor.
It guides a human or agent; the flag does not redesign the starter or change rendering automatically.
Translate it into explicit sections, filters or registered effect props, then validate and inspect the
render. For a stronger native headline beat, set `reveal.easing` to `"ease-out-back"`; it allows a small
travel overshoot while keeping opacity bounded. For per-word blur, opposing slides or elastic
staggering, use the [registered Remotion variants](../../examples/llm-remotion-title/README.md#editorial-typography)
with the configured Node worker.

See the [creative-direction workflow](../../docs/creative-direction.md).

## Relation to `@leclap/mcp`

The CLI and the MCP are two front-ends to the **same** engine:

- **`@leclap/cli` — the manual/human path.** Scaffold + render `template.json` on disk yourself.
- **[`@leclap/mcp`](../leclap-mcp) — the agent path.** An AI agent authors, validates, and renders the
  same descriptors over MCP, inside your own project. A `template.json` from `leclap init` is equally
  usable by the MCP's `compose_video`.

Animated intros are **bring-your-own Remotion**: the MCP's `render_remotion_clip` renders a composition
from _your_ Remotion project (the `remotion/` starter, when you opt in) to a clip, which `compose_video`
composites in front of your scenes. Remotion is optional and design-time only (headless Chromium); the
CLI itself never needs it.

> The generated `.mcp.json` uses absolute env paths (this machine). Regenerate or edit them if you move
> the project.

## FFmpeg

The engine resolves FFmpeg in this order: system FFmpeg (fastest) → `ffmpeg-static` → `@ffmpeg/ffmpeg`
(WASM). Run `leclap diagnose` to see what your environment provides.

When a render fails, `render` prints the reason the engine gave (the filter FFmpeg rejected, the file it
could not probe, the section that failed) and exits with code 1. With `--json`, the same reason is the
`error` field. The default output also writes the full engine log to `build/render.log`.

`ffmpeg-static` ships `ffmpeg` but no `ffprobe`. Templates with transitions, music, whole-video overlays
(`global.animations`, `global.watermark`) or `project_video` clips need an ffprobe to read their media,
so on that path LeClap looks for one in two places:

- the optional `ffprobe-static` package (large: it bundles a binary for every platform);
- an `ffprobe` next to the `ffmpeg-static` binary, for example when `FFMPEG_BIN` points at an FFmpeg
  build that ships both.

With neither, the render stops before encoding anything and names the missing binary and how to install
it.

Installing FFmpeg (`brew install ffmpeg`, `sudo apt install ffmpeg`) provides both binaries, and
LeClap then uses it instead of `ffmpeg-static`. For templates that draw text, that FFmpeg needs the
`drawtext` filter.

## Standalone binaries

`pnpm build:exe` produces self-contained executables (Windows / macOS / Linux) under `dist/bin` via
[`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg).
