# Open in builder: PR media

Media for the pull request that opens a template in the web builder from a link. Every link is a real one, printed by the branch's own `leclap studio`. [`record.mjs`](record.mjs) opens it in the web builder with Playwright at 1280×800 and the default (light) theme. The builder's editor shell is dark by design.

The sample is the bundled `fast-curious.json` template (ten scenes):

```bash
node packages/leclap-cli/dist/index.js studio packages/leclap-creative-kit/src/templates/fast-curious.json --base http://localhost:5394
# http://localhost:5394/studio/builder#t=v1.7Vfbbhs3EP2V7aRoX1bCaiUZzr4kttMABZq0yKV9CAxjxB1q…  (1630 characters)
```

## Video

| File                                           | Caption                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`open-in-builder.mp4`](open-in-builder.mp4)   | The link opening in the builder in 15 s (1280×800, 30 fps, H.264, faststart, about 1 MB, no sound). It starts on the Studio page, opens the link, shows the cleaned address, then walks the ten scenes of the new draft. A caption pill stands in for the address bar. |
| [`open-in-builder.webp`](open-in-builder.webp) | Animated preview to embed inline: the first 8 s of the MP4 at 800 px wide and 12 fps (about 420 KB).                                                                                                                                                                   |

## Images

| File                                             | Caption                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`01-opened.webp`](01-opened.webp)               | The link opened as a new, unsaved draft, with every scene in the strip. The address bar now reads `/studio/builder`: the `#t=` fragment is removed.                                              |
| [`02-rebind.webp`](02-rebind.webp)               | A template that points at files on the author's computer (a music track, a backdrop photo and a clip). The builder lists what to film, upload or pick again, and says that nothing was uploaded. |
| [`03-replace-draft.webp`](03-replace-draft.webp) | A second link arrives while a draft is open: "Open the linked template?", with "Keep this draft" as the default.                                                                                 |
| [`04-broken-link.webp`](04-broken-link.webp)     | A link cut short when it was copied: "This link could not be opened", with the reason and a way out. The builder stays usable behind the card.                                                   |
| [`05-french.webp`](05-french.webp)               | The same link on the French site (`/fr/studio/builder`).                                                                                                                                         |

The stills are full 1280×800 viewport captures, saved as WebP files of 60 KB or less. `01` and `05` add a 44 px address bar strip above the capture. The script draws this strip around the screenshot because a headless browser has no address bar. The page itself is not changed.

## Regenerate

From the repository root, with `ffmpeg` (libx264, libwebp) on `PATH`:

```bash
pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
node scripts/copy-core-assets.ts
(cd apps/leclap-web && npx vite --port 5394 --strictPort) &
BASE=http://localhost:5394 node .github/pr-media/open-in-builder/record.mjs
```

- `ONLY=stills` or `ONLY=video` regenerates one half.
- `CHROMIUM=/path/to/chrome` sets the browser when `@playwright/test` has none of its own.
- Scratch output goes to the git-ignored `build/pr/open-in-builder/`: the PNG captures, the raw WebM and the local-media template.

The script:

1. Builds each link with `leclap studio <template> --base $BASE`.
2. For `02`, writes a copy of `photo-backdrop.json` whose music, backdrop and clip point at `/Users/me/…` and `~/…` paths.
3. For `03`, sets a second link's fragment (`product-launch.json`) while the first draft is open.
4. For `04`, cuts the link to 60 % of its length.
5. Records the take with Playwright's `recordVideo`. The caption pill is injected by the script. The MP4 is encoded with `libx264 -preset slow -crf 24 +faststart`, and the animated WebP with `libwebp_anim -quality 70`.

## Known issues

- The payload in a fresh link can differ from the one quoted above if the bundled template changes.
- Partial scenes show "OR" or an empty frame in the builder's preview. That is how the builder previews them; it is not a recording problem.
