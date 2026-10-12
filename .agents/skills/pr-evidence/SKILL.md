---
name: pr-evidence
description: Use when opening or updating a pull request whose diff touches apps/leclap-web or apps/leclap-expo. Its description must carry before/after snapshots and a before/after evidence video rendered with LeClap itself. Covers what to capture, how to render the video, where the media live and how to embed them.
---

# PR evidence for app changes

## The rule

A pull request that touches **`apps/leclap-web/**` or `apps/leclap-expo/**`** ships with two kinds of evidence in its description:

1. **Snapshots**: before/after stills of every screen the change affects.
2. **A video made by LeClap**: a short before/after evidence clip, rendered by this repo's own engine. It is not a raw screen recording, and it is never a GIF.

Check the trigger against the base branch, not your memory of the diff:

```bash
git diff --name-only origin/main...HEAD | grep -E '^apps/leclap-(web|expo)/' && echo "evidence required"
```

The only exemption is a change with no visible effect, such as tests, types, lint or build config. Even then the description says so in one line (`No visible change: <why>`), so a reviewer knows the evidence was skipped on purpose rather than forgotten.

## 1. Decide what to prove

- **Before** is the branch's base, `git merge-base origin/main HEAD`, not the tip of `origin/main`, which may carry unrelated changes; **after** is the branch. Show the same screen, state, data and viewport on both sides, or the comparison proves nothing.
- Pick the moment that shows the change: the broken state, the fixed state, the new control in use. Avoid navigation or loading screens.
- Use real content, not lorem ipsum or empty states, unless the empty state is the change.

## 2. Capture

Work from two worktrees, one on the merge base and one on the branch, so both sides run the real code. A fresh worktree needs the engine `dist` and the staged assets before the apps run; see the **monorepo-dev-workflow** skill.

### Web (`apps/leclap-web`)

- Run **your own** Vite dev server on a free port in each worktree. Never stop, restart or `pkill` the user's servers or any `pnpm dev`/`vite` you didn't start: it kills their live preview.
- Drive the pages with a standalone Playwright script, not the Playwright MCP, which throttles to about 2 fps and can return stale frames. Models to copy: `.github/pr-media/{typed-fields,open-in-builder,webmcp}/record.mjs` and `camera-warmup/capture.mjs`. Their `make-media.sh` siblings also write an animated WebP (`-loop 0`): don't copy that step, the video replaces it.
- Viewports: **1440×900** and **390×844**, at device scale factor 2.
- Themes: light **and** dark where the surface supports both. The studio is dark-only (`StudioSurface.tsx`), so shoot it once.
- Record the flow with `recordVideo: { dir, size: { width: 1024, height: 768 } }` on the browser context. That gives the capture the video is built from: a 1024×768 capture fills each 4:3 pane exactly, any other shape is letterboxed, and Playwright's default 800×800 gets upscaled.

### Expo (`apps/leclap-expo`)

- Use a **Release** build on the iPhone simulator and on the Android emulator: `pnpm --filter @leclap/expo ios --configuration Release` and `pnpm --filter @leclap/expo android --variant release`. A dev build shows the dev menu and runs slower. The native engine must be built first; see the **ondevice-ffmpeg-engine** skill.
- Release builds need real media, not Git LFS pointers. The app's own media (`apps/leclap-expo/assets/sample.mp4` and `assets/musics/*.mp3`) are in no digest-pinned bundle, so hydrate just those: `git lfs pull --include "apps/leclap-expo/assets/**"`. A bundled template's music, fonts or video must also be registered in `mediaCatalog` `*_ASSETS`, or an on-device compile fails with "unknown".
- Drive the app with Maestro (flows in `apps/leclap-expo/.maestro/`) or its deep links (`leclap://…`), so a capture can be repeated.
- Stills: `xcrun simctl io booted screenshot after.png` and `adb exec-out screencap -p > after.png`.
- Video: `xcrun simctl io booted recordVideo --codec h264 capture.mov` and `adb shell screenrecord /sdcard/capture.mp4`, then `adb pull`.
- The simulator has no camera. A recording flow falls back to Upload there, so say so if the evidence uses an uploaded clip.

## 3. Snapshots

- **Format**: still WebP at quality 80–85, converted with `ffmpeg -i shot.png -c:v libwebp -quality 82 shot.webp`. Use mise's FFmpeg; Homebrew's has no `libwebp`. Never an animated WebP: like a GIF, it's banned.
- **Curate**: about 15 images at most. Prefer before/after pairs of the same state, side by side, composed with `ffmpeg … hstack` or one row of a markdown table.
- **Look at every image yourself** before it goes in. A shot of the wrong state, a spinner or a cropped control is worse than none.

## 4. The video, made by LeClap

Render it with the house before/after workflow in `examples/agentic-pr-video/evidence-skill/`. Read that skill's `SKILL.md` before the first render. The video is a LeClap slate, the two runs side by side and in step (with an optional freeze and highlights), and a closing card.

```bash
pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build   # render with the working copy
python3 examples/agentic-pr-video/evidence-skill/build.py \
  --content <work>/content.json --work <work> \
  --leclap "node packages/leclap-cli/dist/index.js"
```

`build.py` finds the LeClap mark (`apps/leclap-web/public/favicon.svg`) and the fonts in the repo, and renders with `--manifest --qc`.

- **Run `build.py`**: don't hand-compose a comparison around `template.json`. `--content` is the only file you write; copy `content.example.json`. It holds `ticket`, `summary` (the change in one line), `intro.headline`, `outro{headline, subtitle}`, an optional `clipSeconds` and `freeze{at, hold}`, and `sides[]` (`before`, then `after`), each with `badge`, `capture`, `trim`, `chip`, `pane{title, desc}`, and with a freeze its `highlight{x, y, w, h}` (capture pixels) and an optional `callout`.
  - `trim` is a **start offset** into the capture, not a duration. Set each side's trim so both runs reach the change at the same second, and `freeze.at` to that second.
  - An `Overflow` error, or `leclap validate` refusing the resolved template, means the copy is too long: shorten it, never widen the box.
- **FFmpeg**: the cards need an FFmpeg with `drawtext`. Use mise's or `ffmpeg-static` on PATH; Homebrew's has none.
- **Output**: one `.mp4`, H.264 `yuv420p`, tagged bt709 (a bt470bg/yuvj420p tag freezes the video in Chrome), with faststart. Aim for 15–40 s and **under 10 MB**, GitHub's attachment cap on free plans.
- **Watch it** at full speed and on a frame sheet: `ffmpeg -i evidence.mp4 -vf fps=1,scale=480:-2,tile=6x4 sheet.png`.
  - Check both sides read clearly and the labels are right.
  - Check the after side really is the branch.
- **Reconstructed before**: if the before can't be recorded (the base branch doesn't build any more), say so in the description. Never pass a reconstruction off as a recording.

## 5. Store and embed

- **Storage**: put everything under `.github/pr-media/<pr-slug>/`. That means the curated WebP snapshots, the `.mp4`, and the script that produced them (`record.mjs`, `make-media.sh`, `content.json`), so the evidence can be regenerated. Commit them with the PR. This overrides the example skill's "evidence is not committed": that rule is for its scratch renders, while this repo keeps the PR's curated evidence in git. Keep raw captures and scratch renders out of git, in the session scratchpad or a git-ignored `build/`.
- **Images**: use `raw.githubusercontent.com` URLs **pinned to the full commit SHA** that contains them. Pushing new media, or rewriting the branch with a force-push, means updating the pins: a rewritten SHA stops resolving once it's garbage-collected.

  ```markdown
  ![Builder, 390 px: before and after](https://raw.githubusercontent.com/heristop/leclap/<full-sha>/.github/pr-media/<pr-slug>/builder-390.webp)
  ```

- **Video: the inline player is mandatory.** The PR is not done until the video plays in the description. A poster image linking to the `.mp4`, or any link to the file, is **not** an acceptable fallback: GitHub downloads it instead of playing it. Only a GitHub attachment URL, `https://github.com/user-attachments/assets/<id>` pasted on its own line, renders as an inline player; `<video>` tags and `raw.githubusercontent.com` or `github.com/<repo>/raw/…` links don't play.
  - There is no REST or `gh` API for these uploads: only a logged-in GitHub session can make one, and that session is the user's own browser. Drive it with the agent's browser tool (Claude in Chrome, or the equivalent in Codex). Never sign in for the user, and never use a headless or separate browser profile: it isn't logged in.
  - **Attach, automated** ([`attach-video.js`](./attach-video.js)):
    1. Commit and push the `.mp4` first, then build its raw URL pinned to the full SHA: `https://raw.githubusercontent.com/heristop/leclap/<full-sha>/.github/pr-media/<pr-slug>/evidence.mp4`.
    2. Open the PR's conversation page in the user's browser.
    3. With the browser tool's JavaScript execution, paste `attach-video.js` and run `await attachVideo('<raw-url>')`. The page fetches the file itself (no local file access needed), drops it into the comment box the way a drag-and-drop does, waits for GitHub's `https://github.com/user-attachments/assets/<id>` link, and restores the box: no comment is posted.
    4. Write that URL into the description with `gh pr edit <n> --body-file …`, on its own line right after the opening reason.
    5. Verify: `gh pr view <n> --json body` contains the URL, and the PR page shows a `<video>` element in the description.
  - **If the script can't run** (no browser tool connected, or the user isn't logged in), ask the user to connect their browser (the Claude in Chrome extension) and log in to GitHub there, then run the steps above. Until then, leave the video out of the description entirely and say in chat that it's waiting: never a "pending" note or a download link in the description.
  - Never present a download link as the video, and never say the evidence is complete before the video plays.
  - The committed `.mp4` under `.github/pr-media/<pr-slug>/` stays the source of truth for regenerating the video; the attachment is what plays.
  - **No GIF anywhere**, not even as a preview.
- **Publishing needs consent**: uploading the video, committing, pushing and editing the PR are outward-facing. Do them only once the user has asked for the PR or approved it.

## 6. Description shape

- **Open with the reason**: the defect, or what was missing, in plain words. Never open with the change list.
- **Show the evidence right after**: the video first, as its `user-attachments` URL on its own line so it plays inline, then the snapshot pairs with one-line captions (viewport, theme, state).
- **Then** the change, the tests, and anything a reviewer must know: what wasn't captured and why, follow-ups.
- No AI attribution in the description or the commits.

## Checklist

- [ ] `git diff --name-only origin/main...HEAD` touches `apps/leclap-web/` or `apps/leclap-expo/` → evidence required (or a one-line "No visible change" note).
- [ ] Before from `git merge-base origin/main HEAD`, after from the branch, same state and data.
- [ ] Web: 1440 and 390 px, light and dark where both exist. Expo: iOS simulator and Android emulator, Release builds.
- [ ] Every snapshot is a still WebP, looked at, about 15 at most, and pinned to the full commit SHA.
- [ ] The video is rendered by LeClap (`build.py` + the CLI or MCP), H.264 bt709 with faststart, under 10 MB, and watched end to end.
- [ ] The video plays inline in the saved description: a `user-attachments` URL on its own line, checked on the page or in `gh pr view --json body`. No poster or download link stands in for it, and no GIF.
- [ ] The media and the scripts that made them are in `.github/pr-media/<pr-slug>/`.
- [ ] The description opens with the reason.
