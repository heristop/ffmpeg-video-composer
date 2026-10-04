# leclap-ffmpeg-core

The **on-device FFmpeg engine**: a Rust crate that statically links FFmpeg's own
command-line tools (`fftools` — `ffmpeg.c` / `ffprobe.c`) and exposes them to the
[`leclap-expo`](../../apps/leclap-expo) app as in-process `run` / `probe` / `version` / `cancel` calls.
The executor invokes FFmpeg in-process. Android loads the engine `.so` with its FFmpeg dependencies statically embedded; iOS links the engine static library. The app can render from local assets, while templates referencing remote media still require downloads.

This is the **runtime half** of on-device compilation. The **build half** lives in
[`scripts/ffmpeg/`](../../scripts/ffmpeg), which compiles FFmpeg + deps into the static libs
this crate links against. Full architecture:
[`docs/on-device-compilation.md`](../../docs/on-device-compilation.md).

## How it fits together

Runtime output settings belong to the TypeScript host's `ProjectConfig`, not this crate's build flags. The Expo host selects AAC with Android `libopenh264` or iOS `h264_videotoolbox`; template `global.orientation` and `global.fps` resolve the output geometry and frame rate. Native commands remain serial, and registered React effects must be rendered on Node before their clips can be composed locally. See [host configuration](../../docs/on-device-compilation.md#host-configuration) and the [engine configuration reference](../../docs/engine-configuration.md).

```text
template JSON
  → ffmpeg-video-composer (reactnative.ts)         build the ffmpeg argv
  → FFmpegDeviceAdapter                              core ⇄ engine boundary
  → leclap-ffmpeg Expo module (Kotlin / Swift)       JS → native
  → leclap_ffmpeg_core  (THIS crate, via uniffi)     native → FFmpeg
  → libfftools.a + static FFmpeg libs                the actual encode
```

The crate is built into the Expo native module — `jniLibs/<abi>/*.so` on Android, a
`LeclapFfmpegCore.xcframework` on iOS — by
[`scripts/ffmpeg/build-engine.sh`](../../scripts/ffmpeg/build-engine.sh). Those binaries are
**not committed**; that script is how they are (re)produced.

## Public API (uniffi → Kotlin / Swift)

| Symbol                                        | Purpose                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run(args) -> RunResult { code, log }`        | Run one ffmpeg command (argv without the program name). Output goes to the file(s) named in `args`; `log` is the captured stderr — the reason on failure. |
| `probe(args) -> ProbeResult { code, output }` | Run ffprobe, capturing **stdout** (JSON when called with `-print_format json`).                                                                           |
| `cancel()`                                    | Cooperatively stop the in-flight `run` (like one SIGTERM — the transcode loop exits, `run` returns 255). No-op if nothing is running.                     |
| `version() -> String`                         | The linked FFmpeg version string (e.g. `"8.0"`).                                                                                                          |
| `ARGV_ERROR = -2`                             | Sentinel `code` for malformed `args` (empty, or an interior NUL byte) — distinct from any code ffmpeg itself returns.                                     |

`fftools` keep parse/transcode state in process globals and write to the shared stdout/stderr
fds, so **only one invocation runs at a time** (`ENGINE_LOCK` serializes `run`/`probe`); the core issues commands
sequentially. `cancel` bypasses the mutex so it can stop the current `run`, and does not affect `probe`. `version` also runs without the mutex. `ARGV_ERROR` is a Rust constant returned in result codes; it is not a separate uniffi/JS function. `run`/`probe` redirect the C-level fd 1/2 to a temp file to capture output
in-process, restoring it even across a panic.

## Layout

| Path                        | Role                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/lib.rs`                | The engine: argv validation, fd-capture, `run`/`probe`/`cancel`/`version`, uniffi scaffolding.            |
| `csrc/ffmpeg_shim.c`        | C bridge — prepends `argv[0]` and forwards to the renamed `ffmpeg_main` / `ffprobe_main`.                 |
| `build.rs`                  | Compiles the shim and statically links `libfftools.a` + FFmpeg + freetype (via `FFMPEG_PKG_CONFIG_PATH`). |
| `src/bin/uniffi-bindgen.rs` | Generates the Kotlin/Swift bindings (output checked in under `bindings/`).                                |
| `build-android-jni.sh`      | Cross-builds the `.so` for every Android ABI into the Expo module's `jniLibs/`.                           |
| `build-ios-lib.sh`          | Builds the per-slice static libs and assembles the iOS `xcframework`.                                     |
| `.cargo/config.toml`        | Android 16 KB page-size link tuning (Play requirement for 64-bit ABIs).                                   |
| `tests/`                    | `cargo test` runs `run`/`probe`/`cancel` against a host static FFmpeg build.                              |

## Build & test

Run the platform build from the repository root; select `android`, `ios`, or `all` (default). The current scripts assume macOS: Android selects the NDK `darwin-x86_64` host toolchain, and iOS requires Xcode. Prerequisites and pinned versions are described in [On-Device Compilation](../../docs/on-device-compilation.md#building-the-engine-locally).

```bash
bash scripts/ffmpeg/build-engine.sh android
```

For real host tests on macOS, build the patched host libraries first. The host build needs system pkg-config dependencies (freetype, harfbuzz, openh264, libvpx); `build.rs` also links macOS Homebrew dependencies dynamically.

```bash
# Start at the repository root:
bash scripts/ffmpeg/build-host.sh
cd packages/ffmpeg-engine
export FFMPEG_PKG_CONFIG_PATH="$PWD/../../scripts/ffmpeg/dist/host/lib/pkgconfig"
export PKG_CONFIG_PATH="$FFMPEG_PKG_CONFIG_PATH"
export DYLD_FALLBACK_LIBRARY_PATH="$PWD/../../scripts/ffmpeg/dist/host/lib"
export CARGO_TARGET_DIR=target-host
cargo test --release
```

`PKG_CONFIG_PATH` must point at the patched host build, rather than a different system FFmpeg. API changes also require rebuilding the engine and regenerating the Kotlin/Swift bindings, then copying them into the Expo module; `build-engine.sh` stages binaries but does not generate bindings. The `ondevice-ffmpeg-engine` [skill](../../.agents/skills/ondevice-ffmpeg-engine/SKILL.md#regenerating-uniffi-bindings-after-changing-the-rust-api) lists the command and destinations.

LGPL-3.0-or-later (no `--enable-gpl` in the FFmpeg build — see
[`scripts/ffmpeg/common.sh`](../../scripts/ffmpeg/common.sh)).

---

Part of the [LeClap monorepo](../../README.md). On-device pipeline: [On-Device Compilation](../../docs/on-device-compilation.md).
