# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Typed template fields: `leclap render --set name=value` (repeatable) fills a declared `global.fields`
  entry, coerced to its type (`--field` still works; `--set` wins); `leclap resolve <template> [--set …]`
  prints the descriptor a render would see and exits 1 listing every value it would refuse.
- `leclap samples list --category effects`; the catalog now has 46 samples.
- `leclap render --qc` prints output QC findings and exits non-zero on a failing check (`--json`
  includes the report); `--cache <dir>` reuses unchanged sections across renders. `--output` is written
  atomically and refused when it equals the template or a `--video` input.
- `leclap render --manifest` writes `<output>.manifest.json`. Renders use the deterministic encoder
  profile by default (`--no-deterministic` turns it off).
- `leclap verify <manifest> [--rerender]` checks a video against its render manifest, or re-renders the
  recorded template and compares the template, asset, filtergraph and output digests.
- `leclap validate` prints a `→ hint` line under each error that has a known fix, plus advisory motion
  pacing findings that never change the exit code; `--json` includes `hint`, `suggestion`, `kind` and
  `motionWarnings`.
- `leclap render --format <name>` renders one composition of a template with `formats`; `--formats all|a,b`
  renders each to `<output>-<format>.mp4`.
- `leclap style <image|clip> [--json] [--out style-guide.md]` derives a theme and style guide from a reference.
- `leclap beats <audio> [--json]` measures tempo, the beat grid, confidence and drop/build/end cues.
- `leclap init --studio <dir>` scaffolds a production folder; `leclap studio status|pass` tracks its gates.
- `leclap diagnose` reports which features the FFmpeg build can run, with fixes; `--json` prints the
  capability report.
- `leclap snapshot`, `leclap compare` and `leclap timeline [--json]` look at a template's frames, compare
  variants and list where everything sits; all take `--format`.

### Changed

- Built on `ffmpeg-video-composer` 3: `leclap validate` and `leclap render` reject templates with unknown
  keys (`unknown_key`) and text a bundled font cannot draw (`font_missing_glyphs`), which 0.3.0 accepted.

## [0.3.0] - 2026-10-03

### Added

- `leclap samples list` discovers the 32 packaged showcase samples, with category/backend/query
  filters and JSON output. `samples show <id>` reports creative direction, required inputs, assets,
  registered effects and setup instructions.
- `leclap samples export <id>` writes a self-contained descriptor to stdout or creates a new file
  with `--output`; existing files are never overwritten. Media is not included. Registered effect
  samples require the configured MCP effect backend rather than direct CLI rendering.

### Changed

- Requires `ffmpeg-video-composer` 2.5.0 or later for sample discovery and the new JSON motion controls.
- Package tarballs include this changelog.

## [0.2.5] - 2026-09-28

### Added

- `leclap validate` reports geometry warnings — text off the frame or out of the title-safe area,
  colliding, hidden under a band, too small, low-contrast, or unguarded over footage. The headline
  counts them and lists them under it; `--json` carries them on a `warnings` key (absent when there
  is nothing to report). They never change the exit code, so `validate` stays usable as a CI gate.
- When a font is not bundled, `validate` fetches it from the LeClap asset catalog (5s timeout per
  font); offline, it falls back to an estimate and marks the finding approximate.
- `leclap validate --render` also renders the sections that hold text and measures their contrast
  from real pixels, settling text over pictures, grades and looks that the render-free check can
  only flag as unguarded. It costs seconds and needs a native FFmpeg with `drawtext` — it checks
  the FFmpeg it would render with first, and names a build without libfreetype rather than failing
  mid-render. Without one, or when the render fails, it prints the render-free findings and says
  why. The exit code is unchanged.

### Fixed

- `leclap init` approves dependency builds in a scaffolded `pnpm-workspace.yaml` (`allowBuilds`
  for `ffmpeg-static` and `esbuild`) instead of the `package.json` `pnpm.onlyBuiltDependencies`
  field, which pnpm 11+ ignores — a fresh project's `pnpm install` failed on the unapproved
  `ffmpeg-static` build, so the first `render` had no ffmpeg.
- `leclap render` no longer reports success for a video missing a section. When a section fails
  to build, the render exits 1 and prints the engine's cause, naming the section
  (`Section "outro" failed: …`) — also in the `--json` error payload — instead of
  "Compilation failed to produce output". Requires `ffmpeg-video-composer` 2.4.0.
- The same goes for any other render that fails inside the engine: `render` prints the reason it
  gave (the filter FFmpeg rejected, the missing ffprobe, the segment it could not probe), and
  `--json` returns it as `error`, so an agent driving the CLI can act on it.
- A failure the engine reported is no longer followed by the FFmpeg install hints
  (`leclap diagnose`, `npm i ffmpeg-static`, …). They matched any message mentioning FFmpeg, so a
  filter FFmpeg rejected was answered with "reinstall FFmpeg". They still follow an engine that
  fails to start.

## [0.2.3] - 2026-08-15

### Fixed

- `--orientation` now overrides `descriptor.global.orientation` (validated against the
  engine's own enum) — it used to be forwarded to a config field no engine code reads,
  silently no-opping and, worse, flipping portrait templates to landscape by clobbering
  the default video config.
- `leclap init --remotion` scaffolds `.mcp.json` with `LECLAP_MCP_ALLOW_REMOTION=1`, so
  the `render_remotion_clip` workflow the generated README documents is actually
  registered by the server.

## [0.2.2] - 2026-08-13

### Changed

- Refreshed the build toolchain (`@yao-pkg/pkg`, `tsdown`, `tsx`) and dropped a
  redundant cast in `leclap validate`. No user-facing behaviour changes.

## [0.2.1] - 2026-07-24

### Fixed

- Restore the terminal cursor on Ctrl-C during a render — interrupting a render no
  longer leaves the shell with a permanently hidden cursor.
- Keep `leclap render --watch` alive when an OS-level file-watcher error occurs (editor
  rename/replace, `EMFILE`, the watched dir being removed) instead of crashing the process.
- `--json` mode now emits a machine-readable `{ "ok": false, "error": … }` object on
  failure (missing template, bad `--field`/`--video`) instead of coloured stderr text.
- Count physical terminal rows when repainting, so a progress header that wraps on a
  narrow terminal no longer corrupts the live render block.

## [0.2.0] - 2026-06-29

### Added

- `leclap validate <template.json>` — validates a template against the engine schema
  and semantic rules without rendering; path-pointed errors, exit 1 on failure,
  `--json` for a machine-readable result.
- `leclap render` input flags: `-o, --output` (copy the result to a path), repeatable
  `--field key=value` (template variables / form fields) and `--video section=path`
  (project_video inputs), `--locale`, `--orientation`, and `--assets` / `--build`
  directory overrides. Previously only fully-static templates could be rendered.
- `leclap render --watch` re-renders on template/asset changes until Ctrl-C; a failed
  pass is reported but never stops the watcher.
- `leclap render --json` (machine-readable `{ ok, output, bytes, durationMs }`) and
  `-q, --quiet` (final summary only) for CI/scripting.
- Live render progress: an in-place region with a spinner, progress bar, percent,
  elapsed time, and a streaming tail of the latest engine/ffmpeg log lines
  (driven by the engine's new `CompileReporter`); collapses to a one-line summary
  on success and leaves the failing context on screen on error.
- A cohesive "marquee / clapperboard" terminal theme, with the wordmark title in a
  lavender → pink gradient mirroring the web `brand-gradient` (per-glyph on truecolor
  terminals, single-hue fallback elsewhere); status colour reserved for meaning.

### Changed

- Requires `ffmpeg-video-composer` 2.1.1 (the `validate` command uses its exported
  `TemplateValidator`); fonts, music, and catalog media are fetched on demand from
  the public repository (nothing bundled).
- `leclap init` now detects the package manager (npm / pnpm / yarn / bun) and
  prints matching install/run steps, pins `@leclap/cli` to the current version
  (a bare `^0.1.0` excluded `0.2.0`), tracks `@leclap/mcp` and Remotion at
  `latest`, and approves pnpm's native builds so `ffmpeg-static` unpacks.

## [0.1.0] - 2026-06-27

Initial release. The CLI was extracted from `ffmpeg-video-composer` into its own
`@leclap/cli` package.

### Added

- `leclap` binary with [citty](https://github.com/unjs/citty) subcommands:
  `render` (compile a video from a JSON template) and `diagnose`.
- `leclap init` project scaffolder, with prompts to set up the MCP server and
  Remotion.
- Quiet, consistent terminal output.
- Command errors are preserved and surfaced with the right exit code.
