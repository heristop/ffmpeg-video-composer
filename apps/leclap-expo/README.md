# @leclap/expo — LeClap mobile

Expo / React Native client for LeClap. It renders videos **on-device** through an embedded native FFmpeg engine ([`ffmpeg-engine`](../../packages/ffmpeg-engine)) — no server — rendering the same [`@leclap/creative-kit`](../../packages/leclap-creative-kit) templates as the web app and CLI. Record a clip per template section from the camera, preview, then compile. Bundled assets are staged locally; remote assets can still require downloads.

For the mobile gallery, Clappy states, accessibility and poster maintenance, see the [Expo experience guide](../../docs/expo-experience.md).

## Engine configuration

The host stages assets and binds clips/form values into `ProjectConfig`, then injects the native
engine into `compileReactNative`. Descriptor `global.orientation` / `global.fps` determine output;
the app can forward `qualityTier`. Android selects `libopenh264`, iOS selects `h264_videotoolbox`,
both with AAC and serial segment rendering. Registered Remotion effects render on a separate
configured Node backend and must arrive as compatible clips. See [on-device host configuration](../../docs/on-device-compilation.md#host-configuration)
and the complete [engine configuration reference](../../docs/engine-configuration.md).

## Prerequisites

- **Node ≥ 24.11.0**, plus the repo toolchain (`mise install` from the root).
- **Expo SDK 57**, React Native **0.86.3** and React **19.2.3**, with SDK-matched Expo modules.
- A device/simulator and native dev client with the embedded engine; Expo Go does not include it.
- **Xcode** (iOS) / **Android Studio** (Android) for native builds. Rebuild the ignored engine binaries with `scripts/ffmpeg/build-engine.sh`; the current engine scripts assume macOS (including the Android NDK host toolchain). See [On-Device Compilation](../../docs/on-device-compilation.md#building-the-engine-locally).

## Run

```bash
pnpm install            # from the repo root
pnpm app:expo           # Metro dev server, from the repo root
pnpm app:android        # or pnpm app:ios, to build/run the native app
```

Everything runs locally — there is no backend to start. On an Android device/emulator, forward the Metro port for the dev client:

```bash
adb reverse tcp:8081 tcp:8081
```

If Metro uses another port, forward that port instead and update **Change Bundle Location** in the
Android developer menu. An installed dev client can retain the address from a previous session.

## Native build checks

After staging the engine binaries, generate the native projects with
`pnpm --filter @leclap/expo exec expo prebuild --no-install`, then install iOS pods with
`pod install --project-directory=apps/leclap-expo/ios`. The `withIosDeploymentTarget` config plugin
raises dependency targets to the app's iOS deployment floor (16.4 by default), preserving higher
requirements. This also fixes older dependency privacy bundles rejected by Xcode 27.
`expo-build-properties` enables the scene lifecycle required by iOS 27. Keep the lockfile and
regenerate both native projects after dependency or plugin changes. Reanimated 4.5.1 and Worklets
0.10.1 are paired with this SDK; Expo Go does not contain the custom FFmpeg engine.

From the repository root, an Android ARM64 debug build and an unsigned iOS ARM64 simulator build are:

```bash
(cd apps/leclap-expo/android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a)
xcodebuild -workspace apps/leclap-expo/ios/LeClap.xcworkspace -scheme LeClap \
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build
```

These compile the app against the staged engine; they do not rebuild FFmpeg or Rust. To check video
compilation, run the dev client, complete a template's text and clip steps, then select **Create My
Video**. Confirm that the result plays with its animated text and audio. The `leclap://ffmpeg-spike`
route automatically compiles a bounded three-second JSON template twice through `compileOnDevice`.
It covers animated title/caption text, recorded footage, a zoom pulse and bundled music, using the
platform encoder and asset staging from the production service. Each pass probes the output and
requires H.264/AAC, 1280×720 at 30 fps and approximately three seconds; failed runs stop immediately.
Keep Metro running and use `adb reverse` on Android. Hydrate `assets/sample.mp4` from Git LFS before
bundling: a pointer file cannot be decoded. For a full product check, also compile a catalog template
through the editor and confirm playback.

## Notes

- **Routing** — Expo Router (file-based) under `app/`; feature modules under `src/features/` (editor, projects, templates).
- **Permissions** — camera + microphone (recording) and photo library (saving). Grant them in device settings if prompted.
- **Troubleshooting** — clear the cache with `pnpm --filter @leclap/expo exec expo start --clear`; for Android, re-run `adb reverse` after restarting Metro.

---

Part of the [LeClap monorepo](../../README.md). On-device pipeline: [On-Device Compilation](../../docs/on-device-compilation.md). MIT licensed.
