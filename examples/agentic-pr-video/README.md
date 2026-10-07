# Agentic PR evidence video

The example descriptors include `meta.creativeDirection` with their visual intent and review criteria.
See the [creative-direction guide](../../docs/creative-direction.md) for CLI and MCP authoring.

See [engine configuration](../../docs/engine-configuration.md) for CLI bindings, host output defaults and MCP media containment. This native example needs no Remotion backend; keep MCP source recordings inside its configured media directory.

Use this template when an agent has finished a code change and the reviewer needs more than a written summary. The agent collects a short, real screen recording, gives the change and review focus to LeClap, validates the descriptor, and renders a deterministic MP4. Attach the finished file to the pull or merge request beside the code.

LeClap creates the artifact. Uploading it remains an explicit step in your GitHub or GitLab workflow.

## Inputs

- `walkthrough`: a screen recording of the implementation under review
- `project`: the project name shown on the opening card
- `change`: a concise name for the change
- `reviewFocus`: the behavior the reviewer should watch

## Validate

```bash
npx @leclap/cli validate template.json
```

## Render

Run this command from this directory after placing the recording at `./evidence/walkthrough.mp4`:

```bash
npx @leclap/cli render template.json \
  --video walkthrough=./evidence/walkthrough.mp4 \
  --field project="Example project" \
  --field change="Keyboard navigation" \
  --field reviewFocus="Focus order and visible focus states" \
  --output ./build/pr-evidence.mp4
```

Then attach `./build/pr-evidence.mp4` to the PR/MR description or a review comment. Keep the source recording narrow, avoid customer data, and only show evidence that is safe to publish.

## Before / after variant

For a UI change, a single walkthrough still leaves the reviewer comparing against memory. [`before-after.json`](./before-after.json) shows both behaviors in one short clip:

1. a title card with the project and the change
2. the `before` recording, badged **BEFORE**
3. a wipe to the `after` recording, badged **AFTER**
4. a card that says what to review

### Inputs

- `before`: the walkthrough on the base branch (the first 3.8 s are used)
- `after`: the same walkthrough on the branch under review (the first 4.2 s are used)
- `project`, `change`, `beforeCaption`, `afterCaption`, `reviewFocus`: the card and badge texts, set in the template's `global.variables`

Copy the template next to your evidence and edit those variables to describe your change.

### Try it on the demo shop

[`demo-shop/`](./demo-shop) is a fake e-commerce product page, Kiln & Co. With `?v=before` its "add to cart" is a faint grey link that gives no feedback; with `?v=after` it is a primary button that confirms and opens a cart drawer. [`record.mjs`](./demo-shop/record.mjs) records both walkthroughs with Playwright and needs ffmpeg on your PATH. Playwright is resolved from the directory you run it in:

```bash
npm i -D @playwright/test && npx playwright install chromium
node demo-shop/record.mjs
```

This writes `./evidence/before.mp4` and `./evidence/after.mp4`. The demo shop's texts, if you want to reproduce the example exactly: project `Kiln & Co. — shop`, change `Make Add to cart obvious`, beforeCaption `A faint link, and no feedback`, afterCaption `One button, instant cart drawer`, reviewFocus `Button contrast and drawer focus`.

### Validate and render

```bash
npx @leclap/cli validate before-after.json
npx @leclap/cli render before-after.json \
  --video before=./evidence/before.mp4 \
  --video after=./evidence/after.mp4 \
  --output ./build/pr-evidence.mp4
```

Mapping two clips needs a `@leclap/cli` release newer than 0.2.4; earlier versions keep only the last `--video` (and `--field`) flag.

For a real change, point the same two walkthroughs at your app on the base branch and on your branch, then attach `./build/pr-evidence.mp4` to the PR/MR like the single-walkthrough video.

## Feature reel for a large pull request

When a branch adds many features, one walkthrough is not enough. [`motion-effects-reel.json`](./motion-effects-reel.json) cuts already-rendered sample previews into a chaptered reel of about 100 s:

- An intro and a determinism card.
- Five numbered chapter cards. They come from one inline `chapter-card` partial with an `envelope`, so each ref's `duration` stretches only the hold.
- The previews as `video` sections, each trimmed with `options.clip` and labelled by a top `pill` lower third.
- An agent-tooling chapter that shows real CLI output: a `leclap snapshot --sheet` contact sheet, `leclap timeline` lines and the `leclap diagnose` feature count.

Designed transitions join the sections. `global.audio.sfx: "auto"` adds whooshes and hits, and authored `sfx` cues add the rest. The template validates with no findings.

It reads its media from an assets folder: `videos/showcase/*.mp4` from `apps/leclap-web/public` and two pictures, `pictures/snapshot-sheet.png` and `pictures/formats-row.png`. [`.github/pr-media/motion-effects/make-media.sh`](../../.github/pr-media/motion-effects/make-media.sh) stages that folder, renders the reel and makes the PR snapshots:

```bash
npx @leclap/cli validate motion-effects-reel.json
npx @leclap/cli render motion-effects-reel.json --assets ../../build/pr/assets --qc -o ../../build/pr/motion-effects.mp4
npx @leclap/cli snapshot motion-effects-reel.json --at-transitions --per-section --sheet 4x3 --assets ../../build/pr/assets
```

For another branch, keep the partial and the label pattern, and swap in that branch's clips and chapter titles.

[`motion-polish-reel.json`](./motion-polish-reel.json) reuses the same `chapter-card` partial (its underline switched to round caps) for a 43 s reel of the `fx` primitives: four chapters, then one labelled beat per primitive, each effect authored in the template itself on stand-in footage or theme cards rather than cut from previews. [`.github/pr-media/motion-polish/make-media.sh`](../../.github/pr-media/motion-polish/make-media.sh) generates the stand-in clips and renders it.

## Evidence-video agent skill

[`evidence-skill/`](./evidence-skill) turns the before/after idea into an agent skill a team can copy into `.agents/skills/evidence-video/` of the app under review. `before-after.json` lets LeClap draw its own badges and lower thirds; the skill's `build.py` composes every card and panel with ffmpeg first, then hands them to LeClap for the crossfades, the watermark and the render. That buys three things:

- a label panel beside each clip, with the BEFORE/AFTER badge, a title and a wrapped description, while the capture plays next to it, letterboxed rather than cropped;
- copy wrapped on the font's measured glyph widths, with a hard stop (`Overflow: desc: 8 lines > 6 allowed`) instead of text running off the frame;
- one house style: colours, fonts and geometry pinned in `template.json`, applied by the script, and the traps plus the capture and publish checklists in [`SKILL.md`](./evidence-skill/SKILL.md), so every change's video looks like the last one.

It needs Python 3 (standard library only) and an ffmpeg with `drawtext`. On the demo shop:

```bash
node demo-shop/record.mjs --out build/evidence/raw
python3 evidence-skill/build.py --content evidence-skill/content.example.json --work build/evidence \
  --logo ../../apps/leclap-web/public/favicon.svg --leclap "npx @leclap/cli"
```

The video lands in `build/evidence/shop-123-evidence.mp4`, which git ignores.
