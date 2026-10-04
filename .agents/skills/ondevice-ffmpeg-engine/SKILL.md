---
name: ondevice-ffmpeg-engine
description: Use when building, modifying, or consuming the on-device FFmpeg engine — the Rust crate packages/ffmpeg-engine, the leclap-ffmpeg Expo native module, the run/probe/version/cancel API, the uniffi bindings, build-engine.sh, or the FFmpeg-from-source toolchain in scripts/ffmpeg.
---

# On-Device FFmpeg Engine

## Overview

The Expo app renders video **on-device** (no compile server or render upload; remote assets can still require downloads) by running real FFmpeg in-process through a Rust engine that statically links patched FFmpeg `fftools`. The same `ffmpeg-video-composer` core that drives Node/WASM drives this engine via one more `AbstractFFmpeg` implementation. Full architecture + boundary contracts: **`docs/on-device-compilation.md`**.

Two halves:

- **Build toolchain** — `scripts/ffmpeg/` cross-compiles FFmpeg + deps into static libs (`libfftools.a` …) per target.
- **Runtime engine** — `packages/ffmpeg-engine/` (Rust + uniffi) → `apps/leclap-expo/modules/leclap-ffmpeg/` (Expo native module, Kotlin + Swift).

Call chain: core `FFmpegDeviceAdapter.execute(cmd)` → `parseCommand` → `Leclap.run(argv)` (native module) → uniffi → Rust `lib.rs` → C shim `ffmpeg_shim.c` → patched `ffmpeg_main`/`ffprobe_main`.

## API surface (the native module / Rust uniffi exports)

`apps/leclap-expo/modules/leclap-ffmpeg/index.ts` wraps the Expo native module, whose Kotlin/Swift bridges call the generated uniffi functions:

- `run(args: string[]): Promise<{ code, log }>` — runs ffmpeg; `args` **exclude** the program name (the shim prepends `ffmpeg`); captures stderr as `log`.
- `probe(args: string[]): Promise<{ code, output }>` — runs ffprobe; captures stdout (`-print_format json`).
- `version(): string` — FFmpeg build version; also the presence probe (`ffmpegAvailability.ts`).
- `cancel(): void` — cooperative cancel of the in-flight `run` (sets fftools' shutdown flags; the run exits ~as on SIGTERM, returns 255). No-op when idle.

No shell is ever involved — `run`/`probe` invoke `ffmpeg_main`/`ffprobe_main` in-process with an argv array. `run` and `probe` serialize behind a process-global `ENGINE_LOCK` (fftools hold global state). `cancel` deliberately bypasses the lock so it can stop a running invocation; `version` also does not take it. Cancellation does not affect `probe`. Empty argv or an interior NUL returns the Rust `ARGV_ERROR` sentinel (`-2`) before invoking fftools.

## Consuming it from the core

The injected engine seam keeps native module imports out of the core; its `FilesystemExpoAdapter` still uses `expo-file-system`. `CoreCompilationService` injects `run`, `probe`, and optional progress-file/read helpers as the `NativeEngine` into `compileReactNative(...)`; `FFmpegDeviceAdapter` is the `AbstractFFmpeg`. Cancellation is wired from an `AbortSignal` → `Leclap.cancel()` in `CoreCompilationService`. Don't add a second engine path — add capabilities to the core command builders, not here.

## Building (binaries are NEVER committed — rebuild from source)

`scripts/ffmpeg/build-engine.sh [android|ios|all]` orchestrates everything: FFmpeg deps + static libs, then the Rust engine, staged into the module (`android/src/main/jniLibs/`, `ios/LeclapFfmpegCore.xcframework`). Run from the repository root. The current Android scripts assume the macOS NDK host toolchain (`darwin-x86_64`); iOS requires macOS + Xcode. Prerequisites:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android \
  aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
cargo install cargo-ndk            # android (also needs NDK 27.1 — see versions.env)
```

Host build for `cargo test` (real run/probe/cancel/re-entrancy/drawtext) — on macOS, starting at the repository root. The host build resolves freetype, harfbuzz, openh264, and libvpx through system pkg-config; `build.rs` also uses Homebrew library paths on macOS:

```bash
bash scripts/ffmpeg/build-host.sh   # builds scripts/ffmpeg/dist/host/lib/libfftools.a
cd packages/ffmpeg-engine
export FFMPEG_PKG_CONFIG_PATH="$PWD/../../scripts/ffmpeg/dist/host/lib/pkgconfig"
export PKG_CONFIG_PATH="$FFMPEG_PKG_CONFIG_PATH"   # REQUIRED, or Homebrew's ffmpeg .pc leaks in → undefined Wels*/avcodec symbols
export DYLD_FALLBACK_LIBRARY_PATH="$PWD/../../scripts/ffmpeg/dist/host/lib"
export CARGO_TARGET_DIR=target-host
cargo test --release
```

## Regenerating uniffi bindings (after changing the Rust API)

From `packages/ffmpeg-engine/`, with the host environment above still set, build the shared library before generating bindings:

```bash
cargo build --release --lib
cargo run --release --bin uniffi-bindgen -- generate \
  --library target-host/release/libleclap_ffmpeg_core.dylib --language kotlin --language swift --out-dir bindings
```

Copy `bindings/uniffi/leclap_ffmpeg_core/leclap_ffmpeg_core.kt` to `apps/leclap-expo/modules/leclap-ffmpeg/android/src/main/java/uniffi/leclap_ffmpeg_core/leclap_ffmpeg_core.kt`, and `bindings/leclap_ffmpeg_core.swift` plus `bindings/leclap_ffmpeg_coreFFI.h` to the module's `ios/Generated/` directory. These destinations are repository-relative. The bindings use the `leclap_ffmpeg_coreFFI` module name; preserve the module's separately maintained `module.modulemap`. Surface new functions in `LeclapFfmpegModule.kt`, `LeclapFfmpegModule.swift`, and `index.ts`. `build-engine.sh` stages binaries but does not regenerate bindings; rebuild/stage the changed engine and update the binding copies together.

## Gotchas (most cost real debugging time)

- **FFmpeg is pinned to n8.0.** `scripts/ffmpeg/patch-fftools.sh` renames `main`→`ffmpeg_main`, resets fftools globals for **re-entrancy**, and injects the `cancel` hook (the shutdown flags are `static` in n8.0 — the hook must live in the same TU). An FFmpeg bump can silently break all three. **The `cli.rs` + `cancel.rs` host tests are the upgrade gate** — run them after any version change.
- **Android 16 KB pages:** `packages/ffmpeg-engine/.cargo/config.toml` sets `max-page-size=16384` for arm64-v8a/x86_64 (Google Play rule); armv7 stays 4096. Verify with `llvm-readelf -l` → LOAD align `0x4000`.
- **iOS xcframework** needs device **and** simulator slices (`build-ios-lib.sh`); export `IPHONEOS_DEPLOYMENT_TARGET=$IOS_MIN` (else `___chkstk_darwin` undefined) and keep the same binary name in every slice (CocoaPods requirement).
- **Host link:** the macOS host links Homebrew openh264 and libvpx dynamically in `build.rs`; Android embeds both statically, and iOS embeds libvpx but replaces openh264 encoding with VideoToolbox.
- Pins that exist for a reason: **NDK 27.1** (`apps/leclap-expo/plugins/withNdkVersion.js`, for `std::format`), **JNA 5.17** (page alignment), self-contained `.so` (uniffi's JNA dlopen namespace can't resolve transitive FFmpeg `.so`s → everything is statically linked).
- Codecs: Android `libopenh264` (LGPL software), iOS `h264_videotoolbox` (hardware) — set in `CoreCompilationService` `codecConfig`; the LGPL build has **no libx264**.

## Common mistakes

- Editing the staged `.so`/xcframework or expecting them in git — they're gitignored; rebuild with `build-engine.sh`.
- Changing the Rust API without regenerating + copying bindings to both module locations → uniffi checksum panic at load.
- Forgetting `PKG_CONFIG_PATH` for host `cargo test` → confusing `Wels*` link errors.
- Passing the program name in `run`/`probe` args — the shim prepends it.
- Adding capabilities here instead of in the shared core command builders — the engine is just an executor.
