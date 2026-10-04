---
name: evidence-video
description: Create the house-style before/after PR or MR evidence video with build.py and its JSON template. Use when preparing this specific artifact, capturing its evidence, or debugging its render.
---

# Evidence video: the house template

When a task calls for the house-style before/after evidence video, prepare the artifact for the pull
or merge request beside any stills. This skill covers that specific video workflow: the template behind the render
the team settled on, the script that composes it, and the traps between a Playwright capture and a
finished clip.

It is an example from the LeClap repo, written to be dropped into `.agents/skills/evidence-video/` of
the app under review. Keep the rules; swap the look (the `colour.*` and `font.*` variables in
`template.json`) and the mark (`--logo`) for your own.

The published artifact is the final LeClap `.mp4`, embedded inline. **No GIF anywhere in the
description**, not even as a preview or fallback: it is not the deterministic artifact, and it makes
the real video easy to miss.

---

## 0. Do not hand-roll it. Run the two files in this directory.

```bash
python3 .agents/skills/evidence-video/build.py \
  --content <work>/content.json \
  --work <work> \
  --logo <your mark, .svg or .png> \
  --leclap "npx @leclap/cli"      # omit to render with the leclap MCP's compose_video instead
```

**`build.py` IS the house look, and `template.json` alone is not.** The template describes the
_join_: six `project_video` sections, the crossfades, the watermark. Every pixel _inside_ those
sections (the intro card with its kicker, rule and BEFORE/AFTER chips, each side's card, and the
320 px label panel that rides beside the clip with the badge, the title and the wrapped description)
is composed by `build.py` from the `geom.*`, `font.*`, `size.*` and `colour.*` variables in
`template.json`.

**This is the failure that keeps happening**, and it is silent: an agent copies `template.json`,
hand-composes its own cards with whatever is to hand, renders, and ships something that looks
plausible alone and is obviously not the house video beside a real one. Three renders in a row were
rejected this way on one change, each one "using template.json" while never running `build.py`.
**If you did not run `build.py`, you did not build the house video**, whatever the template says.

`--content` is the only file you write. Its shape is [`content.example.json`](./content.example.json):
copy it, because `build.py` rejects a missing or unknown key by name (keys starting with `_` are
notes). It holds `ticket`, an optional `clipSeconds`, `intro{headline}`, `outro{headline,subtitle}`,
and two `sides[]`, `before` then `after`, each with `side`, `badge`, `capture`, `trim`, `chip`,
`card{headline,subtitle}` and `panel{title,desc}`. Capture paths are relative to `--work`.

> **`trim` is a START OFFSET, not a duration.** `build.py` passes it as ffmpeg's `-ss`; the LENGTH
> is the template's clip duration (`clipSeconds` overrides it). The name reads like a length, and
> taking it that way puts the clip at the top of the capture, which on a Playwright walk is login and
> navigation, not the change. Set it to the moment the thing you are proving happens, and verify by
> sampling the BUILT asset (`<work>/assets/videos/beforeclip.mp4`) rather than the final render: the
> crossfades shift the render's timeline. `build.py` stops when `trim` is past the end of the
> capture, and holds the last frame (and says so) when the capture ends before the clip does.

> **`Overflow` is the guard working, not an obstacle.** `build.py` measures every string on real
> glyph advances and stops rather than render off-frame (`Overflow: desc: 8 lines > 6 allowed`).
> Shorten the copy. Never widen the box or bypass the check: that is the defect the measuring exists
> to prevent, and it has shipped an overflowing panel before.

### Try it on the LeClap demo shop

From `examples/agentic-pr-video/` in the LeClap repo, with Playwright and ffmpeg set up as its README
says:

```bash
node demo-shop/record.mjs --out build/evidence/raw
python3 evidence-skill/build.py --content evidence-skill/content.example.json --work build/evidence \
  --logo ../../apps/leclap-web/public/favicon.svg --leclap "npx @leclap/cli"
```

The video lands in `build/evidence/shop-123-evidence.mp4`; `build/` is git-ignored there.

---

## 1. The tool

**LeClap, over MCP**, when the session has the `leclap` server. It is the supported path:

| Tool                  | Use                                                                            |
| --------------------- | ------------------------------------------------------------------------------ |
| `validate_template`   | before every render; names the clips the template expands to (`requiredClips`) |
| `compose_video`       | the render itself                                                              |
| `probe_media`         | duration and codecs of a capture                                               |
| `get_template_schema` | the authoritative field list, rather than guessing                             |

`compose_video` differs from the CLI in ways that cost time to discover:

- `userVideoPaths` is **required** for every `project_video` section, keyed by the _expanded_ names
  (`intro`, `beforecard`, `beforeclip`, `aftercard`, `afterclip`, `outro`), or it answers
  `Missing clips for project_video section(s): …`. It does not scan a media directory.
- Its values must be **absolute** (`Path must be absolute: intro.mp4`) and inside the server's media
  dir (`LECLAP_MCP_MEDIA_DIR` or `--media-dir`, default `~/.leclap/media`), which is also the assets
  root the template's `images/logo.png` watermark resolves against. Start the server with
  `LECLAP_MCP_MEDIA_DIR=<work>/assets`; it reads the variable once, at startup.
- The file lands in `LECLAP_MCP_OUTPUT_DIR` (default `~/.leclap/renders/<id>/`), and `outputBaseName`
  names it. Pass the content of `<work>/evidence.template.json`, the resolved template (§2), as
  `template`.

Run without `--leclap`, `build.py` prints both the CLI command and the exact `userVideoPaths`.

### Getting the tools

Both packages are published, so neither needs a checkout:

```bash
npx @leclap/cli diagnose      # which FFmpeg the render will use; worth running first
npx @leclap/cli validate <work>/evidence.template.json
```

`npx` (or `pnpm dlx`) is fine for a CLI you invoke a few times per video. **An MCP server is the case
where it stops being fine**: it boots on every session, so an unpinned spec pays the package
resolution every time and silently runs whatever was published last. Pin a version in the MCP config
(`@leclap/mcp@<version>`), or, inside the LeClap repo, run the local build
(`node packages/leclap-mcp/dist/index.js` after
`pnpm --filter ffmpeg-video-composer --filter @leclap/mcp build`) so it exercises the
working copy.

**The CLI is the fallback**, for a session with no MCP or when you want `diagnose`. Same engine, same
output. `render` reads assets from `<cwd>/assets` and writes to `<cwd>/build` unless `--assets` and
`--build` say otherwise; `build.py --leclap` passes both, so it runs from anywhere. From the LeClap
repo root, `--leclap "node packages/leclap-cli/dist/index.js"` renders with the working copy.

**Which FFmpeg runs the join is not cosmetic.** In this Node workflow, `diagnose` reports the
system or bundled `ffmpeg-static` binary; the detector's WASM branch is not a pure-Node fallback.
The selected build changes the file: two builds render the same picture but not the same bytes. The template pins `fps` and every engine default it can, but not the
encoder, so "reproducible" means _per FFmpeg build_. Pin one FFmpeg for a batch of changes so their
videos match each other.

LeClap's join itself needs **no `drawtext`**: every section is a `project_video`, so it never draws
text, and an FFmpeg without `drawtext` renders it fine. The `drawtext` requirement in §3 is
`build.py`'s alone.

Work in a scratch directory, outside the repo or under a git-ignored path: evidence is not committed.

---

## 2. The house template

Copy [`template.json`](./template.json) and change the look, not the shape: intro, BEFORE card,
before clip, AFTER card, after clip, outro. Four things about it are not obvious from the schema.

**The pair is a `partial`, declared once.** A card-then-clip unit repeats per side, so it is written
once and referenced twice:

```json
"partials": [{ "id": "pair", "sections": [
  { "name": "card", "type": "project_video", "options": { "duration": 3.6 } },
  { "name": "clip", "type": "project_video", "options": { "duration": 8.0 } }]}],
"sections": [
  { "name": "intro", … },
  { "type": "partial", "ref": "pair", "prefix": "before" },
  { "type": "partial", "ref": "pair", "prefix": "after" },
  { "name": "outro", … }]
```

`prefix` concatenates with **no separator**, so the expanded names are `beforecard` and
`beforeclip`, and since `project_video` resolves its clip by name the assets must be named exactly
that (§3). Do **not** parameterise durations through `variables`: they are typed
`record(string, string | string[])`, so a substituted `{{ }}` arrives where the schema wants a
number. `clipSeconds` in the content file is the one override, and `build.py` writes the resolved
template to `<work>/evidence.template.json` so the render uses the same number the clips were cut to.
A mismatch changes the timeline: the engine caps the section at its declared duration, but a
shorter source can end early. `build.py` holds a short capture to fill its authored clip. Render
`evidence.template.json`, not `template.json`.

**The logo is `global.watermark`, not a baked overlay.** One declaration, composited over every
section and through the crossfades:

```json
"watermark": { "url": "images/logo.png", "position": "top-left", "scale": 0.05, "opacity": 0.9, "margin": 22 }
```

`--logo` puts your product's mark there: a PNG is copied, an SVG rasterised with `rsvg-convert` at
four times its on-screen width. Pick a variant that reads on white. An all-white logo is invisible on
a white card (LeClap's own library `logo.png` is exactly that, which is why the example passes
`favicon.svg`), and a mark inside a rounded container reads as a button. No watermark wanted? Delete
`global.watermark` and `build.py` stops asking for a logo.

**Every card and caption is composed by `build.py` and handed to LeClap as a `project_video`.**
LeClap's own text sugar can be restyled (`titleCard.headlineStyle`, `kickerStyle`, `subtitleStyle`,
`lowerThird.bandColor`), so a white ground alone no longer forces this. What does: the sugar never
wraps, cannot put a label column beside a playing clip, and cannot line chips up with their copy.
For a dark-ground video that needs none of that, its two features are worth knowing, and easy to miss
because a first reading of the schema suggests raw `drawtext`.

`titleCard` on a `color_background` or `image_background` section:

```json
"titleCard": {
  "kicker": { "en": "SHOP-123" },
  "headline": { "en": "PAYMENT PANEL AFTER CANCEL" },
  "subtitle": { "en": "The panel stayed painted over the home screen" },
  "accent": "#565cc4",
  "align": "center",
  "reveal": "rise",
  "effect": { "shadow": true }
}
```

`lowerThird` on a `project_video` section keeps the label on screen _while the run plays_, instead of
on a card the viewer has forgotten by the time anything moves:

```json
"lowerThird": {
  "title": { "en": "The panel survives the cancel" },
  "badge": { "en": "BEFORE" },
  "accent": "#a4122b",
  "reveal": "rise",
  "effect": { "shadow": true }
}
```

`reveal` accepts `none | fade | rise | slide-left | slide-right`. Transitions are `fade` at 0.4 to
0.5 s; set one in `global` and override per section only where you mean to.

**Colour convention**, kept so the clips read the same across changes: **`#a4122b` for BEFORE**,
**`#085d3a` for AFTER**, `#565cc4` for the neutral cards (LeClap's lavender at its 700 tier, a
placeholder for your brand), on `#ffffff`. White text clears AA on all three (7.8, 8.0 and 5.6 to 1).
The red and the green are luminance-matched (0.085 and 0.082): take both from the same tier of your
palette, because a pair two tiers apart looks lopsided. Move both or neither.

**The fonts** are Archivo Black (display), Rubik (body) and Roboto Mono (the ticket kicker), all SIL
Open Font License fonts that LeClap ships in `packages/leclap-creative-kit/src/library/fonts/`.
Inside the LeClap repo `build.py` finds them itself; a copy elsewhere wants them, with their OFL text,
in `./fonts` beside `build.py`, or `--fonts <dir>`. To match your app instead, convert its own font
to TTF or OTF (drawtext cannot read woff2, and `build.py` refuses one by name) and set the `font.*`
variables. Mind variable fonts: drawtext only ever draws the **default instance**, which for Rubik is
Light, whatever other weights the file contains.

---

## 3. The traps, all of which have already cost time

**`project_video` resolves its clip by CONVENTION.** A section named `beforeclip` reads
`<assets>/videos/beforeclip.mp4`. The CLI's `--video <section>=<path>` and the MCP's
`userVideoPaths` map a file explicitly (`@leclap/cli` 0.2.4 keeps only the last `--video`; later
releases take several), and `build.py` writes every clip under its expanded name so the convention
just works. Without an explicit mapping, the Node engine can try a same-named catalog demo clip; a failed
staging attempt logs the section name. Supply deliberate evidence files instead of relying on that
fallback. The current CLI reports the underlying compilation error when available and records the
section sources in `<build>/render.log`; MCP rejects missing required mappings before rendering.

**The engine covers the frame by default.** Its scaler is
`scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720`, so a 4:3 capture (1024×768) in a
16:9 template loses its top and bottom, which is exactly where headers and footers live. `build.py`
sidesteps it: every clip it writes is the canvas size, with the capture fitted inside the stage
beside the panel, never cropped and never stretched. A 4:3 capture fills the 960×720 stage exactly; a
16:9 one is letterboxed onto `colour.stage`. Handing a raw capture to a template directly? Set
`"options": { "forceOriginalAspectRatio": true }` to letterbox, or pillarbox it first:

```bash
ffmpeg -i raw.webm -vf "scale=960:720,pad=1280:720:160:0:black" -r 30 assets/videos/before.mp4
```

**Playwright's video timeline is not wall-clock aligned.** A 15.3 s test produced a 13.9 s file.
Never trim by counting back from the end, and do not trust `Date.now()` arithmetic either. Anchor the
trim on the _event_: profile frame differences to find the click, then cut around it. Crop to where
the change shows, since a small change scores under any whole-frame threshold; a moving cursor scores
too, so read the spikes against the walk:

```bash
ffmpeg -i raw/after.webm -vf "crop=240:60:1040:0,select='gt(scene,0.002)',metadata=print:file=-" \
  -an -f null - 2>/dev/null | grep -o 'pts_time:[0-9.]*'
```

**Trim hard.** Playwright records seconds of blank boot before the app mounts. Every second that is
not the change or its immediate aftermath is a second the reviewer spends not seeing the point.

**`build.py` needs an FFmpeg that has `drawtext`, and the obvious one may not.** Some builds ship
without libfreetype (the Homebrew bottle, at the time of writing), and every card would die on
`No such filter: 'drawtext'`. `build.py` checks up front and stops, but check rather than assume:

```bash
ffmpeg -hide_banner -filters | grep -c drawtext      # 0 means it cannot draw a single card
```

Use the FFmpeg pinned through the repo's `mise.toml`, or pass `--ffmpeg` a verified binary.
`ffmpeg-static` supplies an FFmpeg binary, but this helper's banner probe is separate from LeClap's
ffprobe requirement for the final join. Check the binary's actual version and filters rather than
assuming a particular build. From the repo, locate the optional static binary with
`pnpm --filter ffmpeg-video-composer exec node -p "require('ffmpeg-static')"`.
A container wrapper is another option when its image and mounted paths are controlled:

```bash
mkdir -p <work>/bin && cat > <work>/bin/ffmpeg <<'SH'
#!/bin/bash
exec docker run --rm -v <work>:<work> -v <repo>:<repo>:ro -w "$PWD" jrottenberg/ffmpeg:7-alpine "$@"
SH
chmod +x <work>/bin/ffmpeg
<work>/bin/ffmpeg -hide_banner -filters | grep -c drawtext   # expect 1
```

**Mount every path at its own absolute location**, exactly as above. `build.py` splices absolute
paths straight into filtergraphs and `textfile=` arguments, so a container that relocates them fails
with `No such file` from inside a filter, which reads like a `build.py` bug rather than a mount one.
The repo mount is read-only and is there for the fonts and the logo.

The layout does not depend on which of these you pick. drawtext's own multi-line layout does differ
between builds (6.0 spaces lines by the tallest glyph, 6.1 and later by the font), so `build.py`
anchors every line on its baseline and spaces wrapped lines itself: FFmpeg 6.0 and 8.1 draw the same
panel.

Worse than failing: **a missing `fontfile` does not fail at all.** drawtext silently substitutes a
wide default sans, so the render "succeeds" in the wrong typeface, and the only hint is a stray
`Fontconfig error` line that reads like noise. That is why `build.py` checks and parses each font
before building a filtergraph.

**Inline drawtext copy has multiple escaping layers.** FFmpeg supports escaped quotes; see its
[quoting rules](https://ffmpeg.org/ffmpeg-utils.html#Quoting-and-escaping) and
[filtergraph escaping](https://ffmpeg.org/ffmpeg-filters.html#Notes-on-filtergraph-escaping).
This pipeline uses UTF-8 `textfile=` with `expansion=none` to avoid repeatedly escaping literal copy
through those layers. Its `txt()` helper requires the temporary directory argument, so new house
cards should reuse it rather than introduce inline text handling. This also preserves apostrophes
in French or Italian copy.

Two things `textfile=` does **not** buy you, both of which bit before they were closed. The file is
_decoded_ as UTF-8, so it has to be _written_ as UTF-8: `Path.write_text()` with no `encoding=` uses
the locale's codec, which raises on `’` under a POSIX or latin-1 locale and silently emits cp1252 on
Windows. And `%{…}` is still expanded out of a textfile exactly as it is inline, so `txt()` pins
`expansion=none` ("100 %" is safe). The _path_, finally, is still spliced raw into the filtergraph,
where `:` `,` `;` `'` `\` `[` `]` are syntax: a `--work` containing one fails with
`No option name near …`, so `check_filter_path()` rejects it up front.

**Compose in RGB, not on the YUV frame.** drawbox and drawtext convert their colours with BT.601 on a
YUV frame, while LeClap stamps BT.709 on every segment it writes, so a chip composed in YUV decodes a
few points off (`#a4122b` came back `#a01026` through FFmpeg 6.0). `build.py` composes in RGB and
converts once with the BT.709 matrix, and reads each capture with its own tag (Chrome's recordings
say `bt470bg`).

**Font staging can require a network fetch.** Published engine packages do not bundle the catalog
TTFs. The current asset manager first reuses staged, locally bundled or persistently cached fonts;
only unresolved fonts use the catalog URL or Google Fonts. For offline renders, stage the exact
fonts in the configured assets library rather than assuming a pre-seeded build directory survives
cleanup. `FVC_ASSET_BASE_URL` selects a controlled catalog mirror or pinned source. If a remote
fetch fails, inspect the reported font error and certificate configuration; the current CLI exposes
the underlying compilation error when available. The house cards themselves use the fonts passed
to `build.py`, independently of LeClap's text sugar.

**Raw drawtext does not wrap, so plan for more than one line.** A description can run beyond its
box. Current CLI/MCP geometry checks can issue advisory bounds warnings, but they do not provide
wrapping or prove this custom panel fits. This has already shipped an overflowing panel. Treat every title and
description as multi-line by default and give it a measured width, rather than writing copy short
enough to fit and hoping the next change's is too.

Wrap on real glyph advances, not on a character count: capitals run about a quarter wider, so
`CHECKOUT FLOW` is 216 px and `Checkout flow` 174 px in Archivo Black at 22 px. `wrap.py` reads the
advances straight from the font file (standard library only, no fontTools) and agrees with what
drawtext draws to within 2 px on a full line.

Three rules keep it from breaking again:

- **One drawtext per wrapped line, each from its own `textfile=`.** A newline inside a filter string
  is an escaping minefield, and drawtext's own multi-line spacing changes between FFmpeg builds, so
  `build.py` spaces the lines on the font's line height plus `geom.lineSpacing`.
- **Centre the block on its measured height** (the chip's cap height, the fonts' line heights), so a
  two-line label and a six-line one both sit balanced instead of the long one running off the bottom.
- **Size a badge chip with `box=1:boxborderw=…`, never a fixed `drawbox`.** The box auto-fits its
  text, so a longer badge cannot overflow. The cost is losing a wipe-open animation on the chip; fade
  it instead, which is the right trade against clipping.

A fixed-width label column is where this bites hardest: 320 px of panel is only 240 px of measure
once padded.

**A badge says `BEFORE` or `AFTER`, nothing else**, or their translation (`limit.badgeVocabulary`
lists `AVANT` and `APRÈS` too). It is the one element with no room to wrap, so it gets a two-word
vocabulary and the finding goes in the title beside it. `BEFORE` is 99 px of a 218 px chip budget; a finding
such as `THREE STATES, ALWAYS` is 306 px and belongs in the title. A fixed vocabulary also means the
intro chips and the in-clip badges read as one label rather than two naming schemes.

**Assert the budget; do not eyeball it.** `wrap.py` raises rather than render something off-frame:

```python
from wrap import fits, wrap_checked   # both raise Overflow; a glyph the font lacks raises MissingGlyph
fits('badge', badge, display_font, 22, 240 - 2 * 11)
title = wrap_checked('title', title, display_font, 22, 240, max_lines=3)
desc = wrap_checked('desc', desc, body_font, 19, 240, max_lines=6)
```

`wrap_checked` re-measures each produced line, which is what catches an unbreakable long word that
greedy wrapping cannot help. `build.py` prints the resulting geometry
(`beforeclip: badge BEFORE · title 1L · desc 5L · block 250px · capture 1280x720 → 960x540`), so a
change in copy shows up as a number rather than as a surprise in the render.

The same habit applies to editing a generated build script: a `sed` that matches nothing still exits
0 and the render still "succeeds" with the old text. Prefer a replacement that asserts it matched.

---

## 4. Capturing the two runs

Prefer a **hermetic** capture: stub the backend in the browser context (Playwright `page.route`, or a
recorded HAR) rather than calling a live one. Nothing another session does can disturb it, and no
real customer data reaches the frame.

Record the **built** app whenever the dev server behaves differently (boot endpoints it mocks or
skips, say): serve the production bundle with your preview command and point the capture at that.

Record with Playwright `recordVideo`. The LeClap demo shop's [`record.mjs`](../demo-shop/record.mjs)
shows the choreography: a drawn cursor (headless recordings show none), eased pointer glides, the
page load trimmed off, H.264 out. A 1024×768 viewport fills the stage exactly; 1280×720 is
letterboxed.

**The "before" must be a real build.** Check out `git merge-base origin/main HEAD` in a separate
worktree, build it, and replay the _same_ spec. If you ever reconstruct it instead, by reverting the
change locally, **say so in the description**. A reconstructed before must never be passed off as a
real one.

---

## 5. When the change is subtle

A geometric fix can read as two near-identical clips. This house template stays sequential. If the
task requires a synchronized comparison, author and label a separate variant; `build.py` does not
provide a side-by-side switch. Useful comparison treatments include:

- **side-by-side, synchronised**, so the divergence happens in front of the viewer
  (`ffmpeg -i before.mp4 -i after.mp4 -filter_complex hstack out.mp4`, then hand the result to LeClap
  as one `project_video` section so it still composes the cards and transitions);
- a **persistent reference line** burned across both panes at the pre-change edge;
- the **delta called out numerically** at the moment it occurs;
- permanent pane labels, not a title card that is gone by the time anything happens.

---

## 6. Before you publish

**Watch it.** End to end, and sample frames:

```bash
ffmpeg -i <work>/shop-123-evidence.mp4 -vf "fps=1/1.5,scale=426:-2,tile=4x4" -frames:v 1 sheet.png
```

This has caught bad takes twice: one fired while a "cancelling…" toast was still up, another was
polluted by leftover cart state from a debug run. Both were invisible until someone looked.

**When publication is authorized, upload and embed inline**, rather than leaving a bare link.
Preparing the local artifact does not itself authorize an upload or a PR/MR description edit:

- GitLab: use the [Markdown uploads API](https://docs.gitlab.com/api/project_markdown_uploads/)
  with the target project and multipart file field. Its `markdown` response can be embedded in the description.
- GitHub: use the [supported attachment flow](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).
  The web editor accepts the `.mp4`; supported GitHub CLI versions can also attach local videos.
  Check the installed command before choosing that route.

Add it under an `## Evidence` heading and caption it with what it proves. Preserve the rest of the
description byte-for-byte, except for GIF embeds, which you remove, keeping the uploaded `.mp4`
Markdown exactly as returned. Do not generate, upload or embed a GIF preview.

**Language is a content choice.** Write the copy in the language your reviewers read. A plain-string
content file is one language; `{ "en": "…", "fr": "…" }` objects (LeClap's own translation shape)
carry several, and `--locale` picks one and is forwarded to the render. Add your language's two badge
words to `limit.badgeVocabulary`. When the description is read in one language and the tracker in
another, render once per locale:

```json
"intro": { "headline": { "en": "MAKE ADD TO CART OBVIOUS", "fr": "UN AJOUT AU PANIER ÉVIDENT" } }
```

---

## 7. Machine etiquette

Several agents may share the machine. Use the ports you were given, and address servers as
`127.0.0.1:<port>` rather than by name, which can resolve to IPv6 and reach a different project
entirely.

**Never kill a process you did not start.** Match on the port you were assigned, never on the project
name, which matches every server of that project on the machine, other agents' included.

Stop your own servers before you finish.
