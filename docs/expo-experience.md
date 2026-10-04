# Expo studio experience

The iOS and Android app uses LeClap’s lavender palette, Oswald display typography and system body text. Its light studio surface keeps template previews and the user’s videos central. It opens as soon as fonts are ready, without a mandatory animated intro. Dark appearance is not implemented by this refinement.

## Discovery and navigation

The tab bar contains two destinations: Scenarios and Videos. Creating a template is an explicitly labelled action in Scenarios. Headers consume the top safe area; tabs consume the bottom safe area, so screen content does not receive those insets twice.

The template gallery displays bundled stills from the real showcase renders. Portrait and square stills use `contain`, preserving their full frame. User templates receive a distinct custom cover. Template IDs select posters; names remain the existing navigation keys. Keep the native poster assets and registry in sync when regenerating showcase renders; see `apps/leclap-expo/assets/template-previews/README.md`.

Search matches displayed names and localized section text, including resolved template variables. It ignores accents and surrounding whitespace and accepts regional locales such as `fr-FR`. English and the first available translation provide fallbacks. The search input retains focus while results change. No-result states offer a clear-search action.

Gallery columns follow the measured content width: one below 360 points, two below 700, three below 1000, and four above that. Large system text uses one column. Narrow phones and large system text switch to one column. Gallery bottom spacing reserves room for the Create action. Cards stretch to the tallest content within each row; format metadata stays at the bottom. Headings and sheet content can grow and scroll with text size. Sheets are centered and capped at 640 points on tablets.

## Clappy

Clappy’s fixed paths, frame and palette live in `@leclap/creative-kit/clappy`, shared with the web renderer. The native component uses `react-native-svg`, with no remote artwork, image fetch or extra native dependency.

| State     | Placement                      | Behaviour                                                     |
| --------- | ------------------------------ | ------------------------------------------------------------- |
| `welcome` | Scenarios header, empty Videos | Raised hand; brief greeting lean and lift                     |
| `search`  | Focused search, empty results  | Sideways gaze; brief curious lean                             |
| `error`   | Catalog load failure           | Concerned expression; small reassuring nod                    |
| `working` | Render overlay                 | Focused expression; stationary throughout rendering           |
| `success` | Export sheet                   | Raised arms and happy eyes; brief celebratory lift and settle |

Clappy is decorative and hidden from assistive technology; adjacent text communicates the state. Each reaction lasts 510 ms and animates only the wrapper’s transform on the native UI thread; SVG paths and the React tree are not updated per frame. The mascot stays still in hidden tabs/sheets, while the app is backgrounded, and throughout compilation. Motion respects live system Reduce Motion changes, including re-enabling animations after launch. There are no infinite mascot loops. Shared press controls use opacity feedback instead of scaling under Reduce Motion; sheets replace slides with fades. One shared pair of native subscriptions supplies accessibility and foreground changes to all controls. It ignores stale asynchronous setting reads and releases listeners when the last consumer unmounts. There is no polling.

Press feedback begins on touch-down, remains interruptible, and clears on cancellation, disabling or backgrounding. Actions and navigation run immediately on activation without waiting for animation. Tab selection uses a 120 ms opacity transition and one selection haptic only when navigation is accepted; tapping the current tab or a prevented tab press adds no haptic. Buttons use a native busy indicator instead of a static reload icon. Loading skeleton loops stop in the background and under Reduce Motion.

Reuse `useMotionPreferences` and `styles/motion.ts` for new interactions. Guard Reanimated calls with the live preference, then explicitly use `ReduceMotion.Never` inside that guarded branch: Reanimated’s default system flag reflects startup, so it cannot alone handle a later change back to enabled motion. For Tamagui buttons use the configured `0ms` transition under Reduce Motion, because an undefined transition can still select a default spring.

## Rendering and export

The render overlay reads the real engine progress store. A full-width bar scales from its left edge without animating layout width, and snaps to real progress on cancellation or in the background. It exposes the percentage to screen readers, stage text can wrap, and Cancel remains available while rendering. The privacy message describes the existing on-device compilation path.

The finished-video preview opens Export from its toolbar; recorded-section previews retain Trim, Crop and Retake instead. Each output URI owns a separate export session, so previous save/upload completions cannot disable a new render. Sharing uses `expo-sharing` to attach the MP4 on both Android and iOS, with retry feedback on failure. Adding that native module requires rebuilding existing development clients.

Export offers Save and Share first; uploading to a URL is disclosed on demand. The sheet preserves the bottom safe area, scrolls with the keyboard and exposes expanded, busy and disabled states. Media-library permission and asset modules load when Save is requested. Permission failures return the action to a recoverable state.

New UI copy is supplied in English, French, German, Spanish and Italian. The refined controls use at least 48-point/dp targets. Primary actions use deeper lavender with white labels; ordinary lavender remains the brand accent.

## Verification

Run Expo unit tests and typechecking, lint changed code, check both native Metro bundles, and review the gallery, empty search, render cancellation and export disclosure at phone and tablet sizes. Browser rendering of native components is useful for layout review, but does not verify native safe areas, VoiceOver/TalkBack, device text sizing or permission/share sheets. Those require a simulator or device pass.

## Launcher assets and native compilation check

The Expo launcher uses `assets/images/icon.png`, an opaque 1024-pixel rendering of `assets/icon-source.svg`. The transparent disc in `assets/images/logo.png` is reserved for the in-app logo. The operating system applies the launcher corner mask; the SVG supplies a full-bleed gradient and an inset clapper. Android adaptive icons use separate transparent clapper, full-bleed gradient background, and monochrome layers. The clapper stays inside the central 66/108 safe region; Android supplies the launcher mask and wallpaper tint for themed icons. Sources are `assets/adaptive-{foreground,background,monochrome}.svg`, wired through `android.adaptiveIcon` in `app.json`.

Run `pnpm gen:icons` after editing the SVG, then `pnpm gen:icons:native` to refresh existing prebuilt native assets. A native rebuild and reinstall is required to update the installed launcher. Generated iOS/Android directories remain untracked.

Open `leclap://ffmpeg-spike` in the development app to run two consecutive offline compositions through the production JSON pipeline. Each pass validates H.264 video, AAC audio, 1280×720 at 30 fps, and approximately three seconds of output. The diagnostic preview starts automatically. This is an engine-to-preview check using bundled footage, not a camera or complete editor/export test. Evidence and exact scope are recorded in `.github/media/pr-73/expo/README.md`.

## iOS recording permission verification

Enter a scenario’s recording section to request camera and microphone access in sequence. Either denial must keep recording blocked and expose Open Settings; the status heading covers both permissions. If Settings opens its root page, navigate to Apps → LeClap. After changing permissions, return to the app and reopen the recording section if iOS relaunched it. With both permissions granted, a simulator may report “No camera device available”; that is separate from permission denial. Test real capture on a physical iPhone.

For repeatable simulator checks, use a fresh test device or the supported `xcrun simctl privacy <device> reset all com.heristop.leclap` command. If reset fails and tccd logs report `Database failed to open during _doEval`, restart the simulator without erasing its data and retry. Do not edit TCC databases or force-grant permissions: those actions would bypass the flow being tested. Use normal simulator code signing for native builds. Evidence and tested OS versions are in `.github/media/pr-73/expo/README.md`.

## Adaptive windows and safe areas

The app follows the current window rather than a device model or orientation sensor. `useWindowDimensions` updates layout when a phone rotates, a foldable unfolds, or a multitasking window changes size. The same policy covers narrow cover displays and near-square “passport” windows on Android, and phone, iPad and multitasking windows on iOS. It does not detect a physical hinge or position content around an occluding hinge.

Headers own top insets and bottom tabs own bottom insets. Screen content protects horizontal cutouts. On Android expanded windows the 104-point navigation rail replaces bottom tabs; content then owns the bottom inset to stay above the system taskbar. Fullscreen recording, preview and template creation own all safe edges. Their absolute controls sit inside the inset content container. Native modals have local safe-area providers instead of reusing initial window metrics after rotation.

Content is capped at 1120 points; forms at 720 and sheets at 640. Detail actions move into a 300-point side panel at usable width 840, or width 680 in windows shorter than 480. Android navigation uses a rail at usable width 840 and height 480. Both adaptations fall back to a vertical layout when font scale reaches 1.3. Preview and recording frames fit both available dimensions while preserving the template aspect ratio; window rotation never changes the encoded video format.

`app.json` uses `orientation: "default"` and `ios.requireFullScreen: false`. The `withAdaptiveWindow` config plugin sets Android `resizeableActivity` during prebuild. Small recording windows may request the template capture orientation; large windows remain freely oriented. The Android development-host plugin explicitly uses the application's `BuildConfig.DEBUG`, avoiding a library build flag that could make a debug installation request a missing packaged bundle. A native rebuild is required for these configuration changes; Metro-only reloads are insufficient.

Guidance: [Expo safe areas](https://docs.expo.dev/develop/user-interface/safe-areas/), [Expo app configuration](https://docs.expo.dev/versions/v57.0.0/config/app/), [React Native window dimensions](https://reactnative.dev/docs/usewindowdimensions), and [Android adaptive orientation and resizability](https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability).

Validation includes iPhone portrait/landscape detail screens, an iPad native gallery, and Android emulator windows at 720 × 780 and 960 × 840 density-independent points. Geometry tests also cover narrow windows, large text, resize updates without sensor events, and square previews in short windows. Physical dual-screen/foldable hardware and hinge avoidance have not been verified.
