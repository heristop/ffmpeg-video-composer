# Motion effects: PR media

Media for the `feat/motion-effects` pull request. Everything here was made with the branch's own CLI: the reel is a LeClap template, and every still comes from `leclap snapshot`. The one exception is `09-footage-audio.webp`, which uses frames of the committed showcase previews, because those samples need recorded footage.

## Video

| File                                       | Caption                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`motion-effects.mp4`](motion-effects.mp4) | The branch in 1 min 40 s (1280×720, 30 fps, about 4 MB). Five chapters: motion and type, effects and compositing, footage and audio, formats and platforms, agent tooling. Numbered kinetic chapter cards come from one elastic partial, the showcase previews play in between, and the agent-tooling chapter shows real `snapshot`, `timeline` and `diagnose` output. Sound: `audio.sfx: "auto"` plus sounds from the bundled library. |

The template is [`examples/agentic-pr-video/motion-effects-reel.json`](../../../examples/agentic-pr-video/motion-effects-reel.json).

## Images

| File                                                       | Caption                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`01-kinetic-type.webp`](01-kinetic-type.webp)             | Kinetic typography on springs: cascade with accent, highlight marker, tracking-in and typewriter, counter, impact/pop/scramble. |
| [`02-fx-pack.webp`](02-fx-pack.webp)                       | FX pack: glitch hook with a kinetic trail, rack focus, bars chart with progress, ticker, lower-third styles.                    |
| [`03-camera-transitions.webp`](03-camera-transitions.webp) | Camera rig and graphics: punch-in hits, dolly, letterbox bars, then zoom-through, iris and swipe transitions.                   |
| [`04-fills-layouts.webp`](04-fills-layouts.webp)           | Gradient, photo-texture and shimmer fills inside letters; split screens and a before/after wipe.                                |
| [`05-captions-rtl-emoji.webp`](05-captions-rtl-emoji.webp) | Word-timed captions with karaoke and a crowned payoff; Arabic and Hebrew headlines; colour emoji inside kinetic type.           |
| [`06-formats.webp`](06-formats.webp)                       | One story in three compositions: the same `formats.json` rendered as 16:9, 9:16 and 1:1 (`--format`).                           |
| [`07-theme-safe-zones.webp`](07-theme-safe-zones.webp)     | `theme-roles.json` on the `neon` theme with TikTok's UI zones shaded (`--safe tiktok`).                                         |
| [`08-looks.webp`](08-looks.webp)                           | One frame under every LOOK preset (`--looks`).                                                                                  |
| [`09-footage-audio.webp`](09-footage-audio.webp)           | Footage editing (blur fit, focus pan with a LUT, speed ramp, freeze, cutaway) and sound design (voice preset, auto sfx, beats). |
| [`10-reel-sheet.webp`](10-reel-sheet.webp)                 | The reel itself at twelve moments, from intro to outro.                                                                         |

Every image is WebP, 1280 px wide and under 300 KB.

For one labelled tile per option (every kinetic preset, camera preset, graphic, designed transition, lower-third style, caption DNA, layout, theme, platform, format, look and footage edit), see the documentation [gallery](../../../docs/gallery.md).

## Regenerate

From the repository root, with `ffmpeg` (built with libwebp) and `python3` on `PATH`:

```bash
pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
bash .github/pr-media/motion-effects/make-media.sh
```

[`make-media.sh`](make-media.sh) runs these steps. Scratch output goes to the git-ignored `build/pr/`.

1. Stage the assets in `build/pr/assets`: copies of the creative-kit `sfx`, `emoji`, `fonts` and `backgrounds`, plus `videos/showcase/` from `apps/leclap-web/public`. The engine only reads files that are really under `--assets`, so symlinks out of that folder are refused.
2. Snapshot the samples, for example:

   ```bash
   leclap snapshot examples/motion-design/fx-pack.json --at 1.2,3.0,6.0,8.3,10.4,12.8 --sheet 3x2 --assets build/pr/assets --out build/pr/snap/fx-pack
   leclap snapshot examples/motion-design/formats.json --at 1.6,7.4 --sheet 2x1 --format portrait --assets build/pr/assets --out build/pr/snap/fmt-portrait
   leclap snapshot examples/motion-design/theme-roles.json --at 2.0,5.0,8.4 --sheet 3x1 --safe tiktok --assets build/pr/assets --out build/pr/snap/theme-safe
   leclap snapshot examples/motion-design/split-layouts.json --at 2.4 --sheet 3x3 --looks --assets build/pr/assets --out build/pr/snap/looks
   ```

3. Validate, render and review the reel:

   ```bash
   leclap validate examples/agentic-pr-video/motion-effects-reel.json
   leclap render examples/agentic-pr-video/motion-effects-reel.json --assets build/pr/assets --qc --manifest -o build/pr/motion-effects.raw.mp4
   leclap snapshot examples/agentic-pr-video/motion-effects-reel.json --at-transitions --per-section --sheet 4x3 --assets build/pr/assets --out build/pr/snap/reel-review
   ```

4. Re-encode for delivery. The CLI encodes at the `ultrafast` preset, which gives about 19 MB; the delivery file is `libx264 -preset slow -crf 24` with `-shortest`.
5. Run [`compose.py`](compose.py) to scale the sheets to 1280 px, stack them, add a title band and write WebP files.

`leclap` stands for `node packages/leclap-cli/dist/index.js`.

## Known issues

- `--qc` reports `av_drift`: the audio ends 0.4 s after the picture. Each crossfaded boundary adds 15 to 25 ms of audio, and this reel has 26 boundaries. The delivery encode trims the audio with `-shortest`.
- `--qc` warns that 80% of the audio is silent. The bundled music tracks are Git LFS pointers, so the reel's sound is only sound effects plus the showcase previews' own audio.
