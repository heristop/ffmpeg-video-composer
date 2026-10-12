---
name: evidence-video
description: Create the house-style LeClap before/after PR or MR evidence video with build.py and its JSON template. Use when preparing this specific artifact, capturing its evidence, or debugging its render.
---

# Evidence video: the LeClap house template

When a task calls for the house before/after evidence video, prepare it for the pull or merge request
beside any stills. This skill covers that one workflow: the template behind the render, the script
that composes it, and the traps between a Playwright capture and a finished clip.

The video is three parts, joined by 0.5 s fades:

1. **The slate.** A LeClap clapperboard on the ink canvas: the mark, the ticket as the roll, the
   headline in the brand gradient (Oswald, tracking in), the change in one line, and the BEFORE and
   AFTER fields. The clapper is open; it claps shut, with a clap, on the cut into the comparison.
2. **The comparison.** BEFORE and AFTER play at the same time, in two exact 4:3 panes, each trimmed so
   the change lands on the same second. With `freeze`, both panes hold on that frame, a `frame` stroke
   in each side's colour rings the changed area and a one-line callout names what each side does.
3. **The closing card.** The same slate, clapper shut: what to review, the summary again, where to look
   first, and a small "Made with LeClap".

It is an example from the LeClap repo, written to be dropped into `.agents/skills/evidence-video/` of
the app under review. The look is LeClap's on purpose: see "The house look" below before changing it.

The published artifact is the final `.mp4`, played inline in the description. **No GIF anywhere**, not
even as a preview or fallback: it is not the deterministic artifact, and it makes the real video easy
to miss.

---

## 0. Do not hand-roll it. Run the two files in this directory.

```bash
python3 .agents/skills/evidence-video/build.py \
  --content <work>/content.json \
  --work <work> \
  --leclap "npx @leclap/cli"      # omit to render with the leclap MCP's compose_video instead
```

**`build.py` and `template.json` are the house video together; neither is it alone.** The template
draws the slate, the closing card, the highlights and the clap. `build.py` composes the comparison clip
(the two panes, their badges, titles, descriptions and callouts, the baked freeze), fills the
template's fields with your copy, and checks every string against its box. An agent that copies
`template.json` and hand-composes its own comparison ships something that looks plausible alone and is
obviously not the house video beside a real one. **If you did not run `build.py`, you did not build the
house video.**

`--content` is the only file you write. Its shape is [`content.example.json`](./content.example.json);
copy it, because `build.py` rejects a missing or unknown key by name (keys starting with `_` are notes):

| Key                 | What it is                                                                            |
| ------------------- | ------------------------------------------------------------------------------------- |
| `ticket`            | The PR or MR, shown as the slate's roll and in the comparison header (`PR #109`).     |
| `summary`           | The change in one line. Under the intro headline, and again on the closing card.      |
| `clipSeconds`       | Optional. Length of both runs before the freeze; overrides the template's default 6.  |
| `freeze`            | Optional `{ at, hold }`: hold both panes at section second `at` for `hold` (2–10) s.  |
| `intro.headline`    | The change, in capitals, on one line of the slate.                                    |
| `outro`             | `headline` (what to review, in capitals) and `subtitle` (where to look first).        |
| `sides[]`           | `before` then `after`, each with the keys below.                                      |
| `sides[].badge`     | `BEFORE` or `AFTER` (or `AVANT` / `APRÈS`): nothing else, the chip has a fixed width. |
| `sides[].capture`   | The recording, relative to `--work`. Any size: it is scaled into its pane, never cut. |
| `sides[].trim`      | **Start offset** into the capture, in seconds. Pick it so both runs line up.          |
| `sides[].chip`      | A few words beside the badge on the slate.                                            |
| `sides[].pane`      | `title` (beside the badge above the pane) and `desc` (under it, two lines at most).   |
| `sides[].highlight` | `{ x, y, w, h }` of the changed area, in capture pixels. Required with `freeze`.      |
| `sides[].callout`   | Optional. What this side does, in plain words, on the title row during the hold only. |

Copy is a string, or `{ "en": "…", "fr": "…" }`; `--locale` picks one and is forwarded to the render.

> **`trim` is a START OFFSET, not a duration.** `build.py` passes it as ffmpeg's `-ss`; the length is
> `clipSeconds`. Taking it as a length puts the clip at the top of the capture, which on a Playwright
> walk is the page load, not the change. Set each side's trim so both runs reach the change at the same
> second, then set `freeze.at` to that second. `build.py` refuses a trim past the end of the capture,
> and a capture too short for `trim + clipSeconds`, rather than freezing one pane on its last frame.

> **`Overflow` is the guard working, not an obstacle.** `build.py` measures every string on the
> font's real glyph advances and stops rather than render off-frame (`Overflow: before desc: 3 lines >
2 allowed`). It then runs `leclap validate` on the resolved template, where the engine lays out the
> slate's HTML layers itself and stops on `html_overflow` or a field longer than its `maxLength`.
> Shorten the copy. Never widen the box or bypass the check.

### Try it on the LeClap demo shop

From `examples/agentic-pr-video/` in the LeClap repo, with Playwright and ffmpeg set up as its README
says:

```bash
node demo-shop/record.mjs --out build/evidence/raw
python3 evidence-skill/build.py --content evidence-skill/content.example.json --work build/evidence \
  --leclap "npx @leclap/cli"
```

The video lands in `build/evidence/shop-123-evidence.mp4`; `build/` is git-ignored there. The demo
shop records 1280×720, so its panes are letterboxed: that is the 16:9 case working as intended.

---

## 1. The tool

**LeClap, over MCP**, when the session has the `leclap` server. It is the supported path:

| Tool                  | Use                                                                      |
| --------------------- | ------------------------------------------------------------------------ |
| `validate_template`   | before every render; names the clip the template needs (`requiredClips`) |
| `compose_video`       | the render itself                                                        |
| `probe_media`         | duration and codecs of a capture                                         |
| `get_template_schema` | the authoritative field list, rather than guessing                       |

`compose_video` differs from the CLI in ways that cost time to discover:

- `userVideoPaths` is **required** for the `project_video` section: `{ "sidebyside": "<abs path>" }`.
  It does not scan a media directory.
- Its values must be **absolute** and inside the server's media dir (`LECLAP_MCP_MEDIA_DIR` or
  `--media-dir`, default `~/.leclap/media`), which is also the assets root that `images/leclap-mark.png`
  resolves against. Start the server with `LECLAP_MCP_MEDIA_DIR=<work>/assets`; it reads the variable
  once, at startup.
- Pass the content of `<work>/evidence.template.json`, the resolved template (§2), as `template`.

Run without `--leclap`, `build.py` prints both the CLI command and the exact `userVideoPaths`.

### Getting the tools

```bash
npx @leclap/cli diagnose      # which FFmpeg the render will use; worth running first
npx @leclap/cli validate <work>/evidence.template.json
```

`npx` is fine for a CLI you invoke a few times per video. **An MCP server is where it stops being
fine**: it boots on every session, so an unpinned spec silently runs whatever was published last. Pin a
version in the MCP config (`@leclap/mcp@<version>`), or, inside the LeClap repo, run the local build
(`node packages/leclap-mcp/dist/index.js`).

**The CLI is the fallback**, for a session with no MCP. Same engine, same output. `build.py --leclap`
renders with `--manifest` (digests for `leclap verify`) and `--qc` (a malformed output fails the render
instead of reaching the PR). From the LeClap repo root, `--leclap "node packages/leclap-cli/dist/index.js"`
renders with the working copy; check `leclap render --help` for the flags your version has.

**Which FFmpeg runs the render is not cosmetic.** Two builds render the same picture but not the same
bytes. The template pins `fps`, `seed` and every engine default it can, so a re-run with the same FFmpeg
is byte-identical; pin one FFmpeg for a batch of changes so their videos match each other.

Work in a scratch directory, outside the repo or under a git-ignored path.

---

## 2. The house template

[`template.json`](./template.json) is three sections: `intro` and `outro` (`color_background`) and
`sidebyside` (`project_video`). Some things about it are not obvious from the schema.

**The copy is typed `global.fields`.** `ticket`, `headline`, `summary`, the badges and chips, and the
outro lines are `text` fields with a `maxLength`; the slate's HTML layers and kinetic headline read
them as `{{ name }}`. `build.py` writes your copy into each field's `default` in the resolved template,
so the engine still type-checks it and HTML-escapes it where an HTML layer draws it. The defaults in
`template.json` are the demo shop's copy, so the template validates with no input.

**The clip length is a typed field too (`clipSeconds`)**, used as the whole value of
`"duration": "{{ clipSeconds }}"`, so it lands as a number and is range-checked (2–20 s). `build.py`
fills it as a number in the resolved copy and drops it, and adds the hold: a `project_video` lasts at
most its declared duration, so without that the freeze would push the end of both runs off the cut.
`leclap timeline` and `snapshot` assume a 3 s clip for a length that is still a field, so render, time
and snapshot `<work>/evidence.template.json`, never `template.json`.

**The highlights are added per change.** `build.py` writes one `frame` graphic per side into the
resolved `sidebyside` section: `trace: "fade"` and `exit: "fade"` (where it is matters, not how it
arrives), `contrast: "shadow"` so a pastel stroke still reads on a white UI, and the side's colour. They
are per-change data, so keep them out of `template.json`.

**The freeze is baked by `build.py`, not left to `options.freeze`.** The engine's freeze would hold
the whole frame, labels included, so a callout drawn into the clip could never appear during the hold.

**One transition, a fade.** In an evidence video every boundary means the same thing, "next part of
the same proof". Three treatments were tried and dropped, so do not bring them back without a reason:
a push that moved the labels while they were being read, a wipe whose edge cut the labels, and a split
layout that cover-cropped the 4:3 panes.

**`fit: "letterbox"` on `sidebyside`.** The built clip is already 1280×720, so it changes nothing
today; it is there so a stray asset is padded rather than cropped.

`dead_air` on the intro is expected: 1 s to 3.9 s is the time to read the slate, and the clap ends it.
`front_loaded` on `sidebyside` is expected too: its motion is the footage.

### The house look

The video is LeClap's, so it uses LeClap's tokens (`DESIGN.md` in the LeClap repo), dark theme:

- **Ink canvas** `#141416`, raised board `#1d1e21`, hairlines `#323337`, text `#f7f7f8` and `#afb0b4`,
  a pane letterbox in the player's ink `#0c0d11`.
- **BEFORE is rose** `#f96f99` (secondary-500) and **AFTER is lavender** `#9298fb` (brand-400): one
  tier each, luminance-matched (0.34 and 0.36), and both carry ink text at 7:1. Move both or neither.
- **The brand gradient** (lavender → rose → pastel yellow, the dark theme's `--grad-text`) fills the
  slate headline, and a soft lavender glow sits behind the slate.
- **The clapper** wears the mark's own stripes (`#fef0a6` and `#8c80d8`, outlined `#5e51ac`). The mark
  is `apps/leclap-web/public/favicon.svg`, rasterised unrecoloured into `assets/images/leclap-mark.png`
  (`build.py` finds it in the repo; elsewhere pass `--logo` the SVG or `pwa-512x512.png`).
- **Type:** Oswald for the headline, badges and pane titles, Rubik for copy, Roboto Mono for slate data
  (the roll, the callouts, "Made with LeClap"). All three are OFL fonts LeClap ships.
- **Grid:** 32 px margins and gutter, every vertical step on a 4 px grid, every line on a baseline. The
  slate and the closing card share one rhythm: header row, rule, headline, summary, rule, field row.

The `global.variables` hold the comparison clip's tokens, and the slate's HTML layers carry the same
values in their CSS, so change both together.

**Motion, with restraint.** Tracking-in on the intro headline, a rise on the outro's, fields that rise
12 px into place, the clapper's one clap (two still states and the `clap` sound at 3.4 s), and the
highlight fade during the hold. Nothing moves under text while it is read: the comparison's labels are
static, the callouts fade in after the hold starts and out before the runs move again.

### Why the slate is HTML layers and the comparison is drawtext

The slate is engine-drawn: HTML layers for the board, the fields and the clapper (Satori gives real
font weights, letter-spacing, rounded chips and flex alignment), kinetic type for the headline. It uses
the registry families Oswald, Rubik and Roboto Mono, which every LeClap engine ships, so it needs no
`global.fonts` and no network; `global.fonts` is for a face the registry does not carry.

The comparison is `build.py`'s `drawtext`, because its text has to change exactly with the baked hold
(the callouts fade in and out on the frozen frame) and sit on one baseline grid with the panes. The
cost: drawtext draws a variable font's default instance only, so Rubik is drawn Light there. On the ink
ground that reads well, and `wrap.py` measures exactly what is drawn.

---

## 3. The traps, all of which have already cost time

**`project_video` resolves its clip by convention.** The section named `sidebyside` reads
`<assets>/videos/sidebyside.mp4`, which is where `build.py` writes it. The CLI's `--video` and the MCP's
`userVideoPaths` map a file explicitly.

**Playwright's video timeline is not wall-clock aligned.** A 15.3 s test produced a 13.9 s file. Anchor
each trim on the event: sample frames around it, or profile frame differences cropped to where the
change shows, then set the two trims so the event lands on the same section second:

```bash
ffmpeg -i raw/after.webm -vf "crop=240:60:1040:0,select='gt(scene,0.002)',metadata=print:file=-" \
  -an -f null - 2>/dev/null | grep -o 'pts_time:[0-9.]*'
```

Measure `highlight` on a full-resolution frame of the capture at the freeze second
(`ffmpeg -ss <trim+at> -i raw/before.webm -frames:v 1 f.png`), and check it by drawing it
(`-vf drawbox=x=…:y=…:w=…:h=…:c=red`) before you render.

**Trim hard.** Every second that is not the change or its immediate aftermath is a second the reviewer
spends not seeing the point. A 1024×768 capture fills its pane exactly; anything else is letterboxed.

**`build.py` needs an FFmpeg with `drawtext`, and the obvious one may not have it.** Some builds ship
without libfreetype (the Homebrew bottle, at the time of writing). `build.py` checks up front:

```bash
ffmpeg -hide_banner -filters | grep -c drawtext      # 0 means it cannot draw a single label
```

Use the FFmpeg pinned through the repo's `mise.toml`, or pass `--ffmpeg` a verified binary. A container
wrapper works if it **mounts every path at its own absolute location**: `build.py` splices absolute
paths into filtergraphs and `textfile=` arguments.

**A missing `fontfile` does not fail.** drawtext silently substitutes a default sans, so `build.py`
checks and parses each font before building a filtergraph. Outside the LeClap repo, copy the three
fonts with their OFL text into `./fonts` beside `build.py`, or pass `--fonts <dir>`.

**Inline drawtext copy cannot carry an apostrophe.** Every string goes through `txt()`, a UTF-8
`textfile=` with `expansion=none` (so "100 %" is safe). The path is still spliced raw into the
filtergraph, where `:` `,` `;` `'` `\` `[` `]` are syntax, so `build.py` rejects a `--work` containing one.

**Compose in RGB, not on the YUV frame.** drawbox and drawtext convert colours with BT.601 on a YUV
frame, while LeClap stamps BT.709, so `build.py` composes in RGB and converts once with the BT.709 matrix.

**Wrap on real glyph advances, not a character count.** `wrap.py` reads the advances straight from the
font file (standard library only) and agrees with drawtext to within 2 px on a full line. Descriptions
wrap to at most two lines, re-broken where the two lines come closest in width so no word is stranded.
Badges get a fixed vocabulary (`limit.badgeVocabulary`) and one fixed width, so BEFORE and AFTER read as
a pair and the titles beside them start on the same x.

The same habit applies to editing a generated build script: a `sed` that matches nothing still exits 0
and the render still "succeeds" with the old text. Prefer a replacement that asserts it matched.

---

## 4. Capturing the two runs

Prefer a **hermetic** capture: stub the backend in the browser context (Playwright `page.route`, or a
recorded HAR), so nothing another session does can disturb it and no customer data reaches the frame.

Record with Playwright `recordVideo` at **1024×768**: it fills a 4:3 pane exactly. The LeClap demo
shop's [`record.mjs`](../demo-shop/record.mjs) shows the choreography: a drawn cursor (headless
recordings show none), eased pointer glides, the page load trimmed off, H.264 out.

**The "before" must be a real build.** Check out `git merge-base origin/main HEAD` in a separate
worktree, build it, and replay the same spec. If you ever reconstruct it instead, by reverting the
change locally, **say so in the description**.

---

## 5. Before you publish

**Watch it.** End to end at full speed, and on a frame sheet:

```bash
ffmpeg -i <work>/<ticket>-evidence.mp4 -vf "fps=1,scale=426:-2,tile=4x4" -frames:v 1 sheet.png
```

Then check full-resolution frames of the slate, the comparison, the freeze with its highlights and
callouts, and the closing card. This has caught bad takes before: one fired while a toast was still up,
another was polluted by leftover cart state from a debug run.

**`--qc` is the format check**: H.264 `yuv420p`, bt709 tags, faststart, frame count. Its `silence`
judgement warns that the track is almost silent; that is expected, the clap is the only sound.

**The video must play inline in the description.** A poster or a link to the file is not acceptable:
GitHub downloads a linked `.mp4` instead of playing it. Uploading and editing the description are
outward-facing, so do them only once the user has approved publishing:

- **GitHub:** only an attachment URL (`https://github.com/user-attachments/assets/<id>`, pasted on its
  own line) renders as a player. `<video>` tags and `raw.githubusercontent.com` or `github.com/…/raw`
  links do not play. There is no REST or `gh` API for these uploads: it takes the web editor of a
  logged-in browser: the user's own, driven by the agent's browser tool (Claude in Chrome, or the
  equivalent in Codex). Keep the file under 10 MB (the attachment cap on free plans). Automate it
  with LeClap's [`attach-video.js`](../../../.agents/skills/pr-evidence/attach-video.js): run in the
  PR page, it fetches the pushed `.mp4` from its raw URL, drops it into the comment box like a
  drag-and-drop, returns the `user-attachments` link and posts nothing. Then write the link into the
  description with `gh pr edit` and check the page shows a `<video>` player. With no browser tool
  connected, ask the user to connect one and stay logged in; meanwhile keep the video out of the
  description rather than adding a pending note.
- **GitLab:** use the [Markdown uploads API](https://docs.gitlab.com/api/project_markdown_uploads/)
  and embed the `markdown` it returns.

Never present a download link as the video, and never call the evidence complete while the upload is
pending. Preserve the rest of the description byte for byte, except GIF embeds, which you remove.

**Language is a content choice.** Write the copy in the language your reviewers read. When the
description is read in one language and the tracker in another, render once per `--locale`.

---

## 6. Machine etiquette

Several agents may share the machine. Use the ports you were given, and address servers as
`127.0.0.1:<port>` rather than by name. **Never kill a process you did not start.** Stop your own
servers before you finish.
