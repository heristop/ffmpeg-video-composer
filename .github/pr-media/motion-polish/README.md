# Motion polish: PR media

Media for the motion-polish work on `feat/motion-effects`: the procedural `fx` primitives, the v2 strokes and the bundled templates composed from them. The reel is a LeClap template rendered with the branch CLI, and the stills come from `leclap snapshot`, the motion-review harness or the engine-rendered picker posters.

## Video

| File                                     | Caption                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`motion-polish.mp4`](motion-polish.mp4) | Every primitive in 43 s (1280×720, 30 fps, about 3.8 MB). Four numbered chapters (light, marks, ambient, surfaces and strokes), then one beat per primitive with a mono label naming it and its key field. A twin sheen crosses the title on the intro. The footage is a stand-in: the bundled photographs set in motion. Sound: `audio.sfx: "auto"`. |

The template is [`examples/agentic-pr-video/motion-polish-reel.json`](../../../examples/agentic-pr-video/motion-polish-reel.json).

## Images

| File                                                       | Caption                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-sheen-before-after.webp`](01-sheen-before-after.webp) | The product-launch hero sweep on the Moo Mug. Before: the `shine_sweep` APNG, a grey band over the whole frame (frames of the previous showcase render). After: the fx `sheen`, a specular band clipped to the product shot (`leclap snapshot` of the branch template). |
| [`02-library-grid.webp`](02-library-grid.webp)             | The builder picker's posters, rendered by the engine (`pnpm gen:animation-thumbs`): the 13 fx primitives (ripple and glint in two variants) and the three v2 strokes, by family.                                                                                        |
| [`03-template-finishes.webp`](03-template-finishes.webp)   | Four template moments before and after the fx pass: interview (smoked glass, v2 corners), present-yourself (bokeh intro, edge-glow name band), photo-backdrop (bloom, v2 frame). Footage is the harness's stand-in gradient.                                            |

The [docs gallery](../../../docs/gallery.md#light-and-effects) has one labelled tile per primitive and per v2 stroke.

## Regenerate

From the repository root, with `ffmpeg` (built with libwebp) on `PATH`:

```bash
pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
bash .github/pr-media/motion-polish/make-media.sh
```

[`make-media.sh`](make-media.sh) stages the bundled fonts, sfx and photographs under the git-ignored `build/pr-polish/`, generates the stand-in clips, validates and renders the reel, writes a review sheet of every transition, re-encodes the delivery copy and rebuilds the library grid ([`library-grid.sh`](library-grid.sh)).

The before/after sheets need renders of the previous state:

- [`sheen-before-after.sh`](sheen-before-after.sh) takes a strip of eight frames of the previous showcase `product-launch.mp4` (t = 2.9 to 4.3 s) and the frames of `leclap snapshot` on the branch template with `--video video_1=examples/showcase/media/moo-mug.mp4` (the moments are listed in the script).
- [`template-finishes.sh`](template-finishes.sh) takes two `pnpm motion:review:templates` runs, one at the commit before the templates were composed from fx primitives (`--before <ref>`) and one on the branch.
