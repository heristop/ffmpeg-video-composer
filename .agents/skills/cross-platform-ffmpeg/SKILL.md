---
name: cross-platform-ffmpeg
description: Use when working with FFmpeg across Node/Static/WASM, the PlatformBridge, the FFmpeg detection/fallback chain, or browser/React Native runtime constraints in ffmpeg-video-composer.
---

# Cross-Platform FFmpeg

## Adapter wiring

Shared command builders use `AbstractFFmpeg`. The Node entry point uses `PlatformBridge`; the browser and React Native entry points register their own adapters directly. Do not route their bundles through `PlatformBridge`, which imports Node modules. Architecture: `docs/architecture.md`.

| Entry point           | FFmpeg                                          | Filesystem                             | Logger              | Music                |
| --------------------- | ----------------------------------------------- | -------------------------------------- | ------------------- | -------------------- |
| `src/index.ts` (Node) | `FFmpegNodeAdapter` or `FFmpegStaticAdapter`    | `FilesystemNodeAdapter`                | `PinoLogAdapter`    | `MusicNodeAdapter`   |
| `src/browser.ts`      | `FFmpegWasmAdapter`                             | `BrowserFilesystemAdapter` (IndexedDB) | `BrowserLogger`     | `MusicWasmAdapter`   |
| `src/reactnative.ts`  | `FFmpegDeviceAdapter` (injected `NativeEngine`) | `FilesystemExpoAdapter`                | `ReactNativeLogger` | `MusicFFmpegAdapter` |

Paths above are relative to `packages/ffmpeg-video-composer/`. FFmpeg and music adapters live in `src/platform/ffmpeg/`; filesystem adapters live in `src/platform/filesystem/`, and the Node logger lives in `src/platform/logging/`. The logger classes for browser/RN live in their entry points.

## Detection and probing

`FFmpegDetector.detect()` tries system `ffmpeg -version`, then the `ffmpeg-static` binary. Both adapters use `execFile` with `parseCommand` argv, without a shell. System detection does not check `ffprobe`; `FFmpegNodeAdapter.getInfos()` expects `ffprobe` on PATH.

The detector also has a WASM branch, but `detectWasmFFmpeg()` refuses environments without `window`. It is not a working pure-Node fallback. Browser hosts use `browser.ts` directly. With no available backend, the Node bridge throws with installation instructions.

`ffmpeg-static` ships only FFmpeg. `resolve-ffprobe.ts` selects an existence-checked binary from the optional `ffprobe-static` package or beside the resolved FFmpeg binary. Without one, `FFmpegStaticAdapter.probeUnavailableReason` is set. `director/render-needs.ts` rejects probing templates before the first segment encodes: non-cut transitions, whole-video overlays, enabled/resolved music, and `project_video` sections. `MusicNodeAdapter` probes and loops through the selected adapter's `binaries`, preserving the static path.

## Browser / WASM constraints

- IndexedDB assets are copied into FFmpeg's separate in-memory MEMFS before commands, and outputs copied back (`FFmpegWasmAdapter`). IndexedDB quota does not increase WASM memory capacity; large inputs and intermediate copies can exhaust memory. Treat the approximate 2 GB WASM input ceiling as a limit, not a supported project size.
- `FFMPEG_CORE_VERSION` and the default CDN loader live in `src/platform/ffmpeg/ffmpeg-core.ts`. Hosts can supply `BrowserCompileOptions.loadFFmpegCore`; keep the served core in sync with that pin.
- Use the filesystem adapter's fetch/staging helpers for assets. Browser fonts must be bundled font IDs or readable TTF files; family-based Google font resolution is rejected (`supportsRemoteFonts = false`).
- WASM progress goes through `AbstractFFmpeg.progressListener` using elapsed microseconds and the director's expected duration. The event manager carries compilation events. Web cancellation emits `task-cancelled` and stops at director checkpoints; it does not terminate an active WASM command.
- WASM and device adapters keep `supportsConcurrentExecute = false`; Node/static support independent child processes. Use the explicit `usesVirtualFilesystem` / `hasVirtualFilesystem` capability rather than importing the WASM class into shared code.

## Changes across runtimes

Keep imports from `browser.ts` browser-safe and imports from `reactnative.ts` free of Node/WASM worker dependencies. Add shared command features in managers/presets; extend adapter contracts only when execution actually needs a new capability. Validate the emitted filters against `docs/runtime-capabilities.md` and the device allowlist in `scripts/ffmpeg/common.sh`; a changed allowlist requires rebuilt native binaries. For native build and cancellation details, read `docs/on-device-compilation.md` and the `ondevice-ffmpeg-engine` skill.
