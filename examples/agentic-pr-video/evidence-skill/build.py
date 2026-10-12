#!/usr/bin/env python3
"""Build the LeClap before/after evidence video: compose the comparison clip, then hand it to LeClap.

  python3 build.py --content content.json --work build/evidence --leclap "npx @leclap/cli"

--content is the only file you write; content.example.json is its shape. The video is the LeClap
slate (intro), the two runs side by side and in step, and the closing card (outro).

LeClap draws the slate and the outro from template.json: HTML layers for the board and its fields,
kinetic type for the headline, the hinged clapper and its clap, and the `frame` highlights. This
script composes what the engine cannot: two exact 4:3 panes playing at once, each trimmed so the
change lands on the same second, the freeze baked into both, and the pane labels and callouts, all
measured on real glyph advances so nothing runs off its box. Every colour, size and position comes
from global.variables in template.json, so a render is reproducible from those two files.
"""

import argparse
import itertools
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys

from wrap import CopyError, cap_height, fits, width, wrap_checked

SKILL_DIR = pathlib.Path(__file__).resolve().parent
# Where the LeClap repo keeps its OFL fonts and its mark. A copy of the skill elsewhere finds the
# fonts in ./fonts and takes the mark from --logo.
LIBRARY_FONTS = pathlib.Path("packages/leclap-creative-kit/src/library/fonts")
LECLAP_MARK = pathlib.Path("apps/leclap-web/public/favicon.svg")
MARK_ASSET = "images/leclap-mark.png"
# The mark is drawn at 40 px on the slate; rasterise it at 4x so the engine's downscale stays crisp.
MARK_RASTER = 160

# Compose in RGB and convert once, with the matrix the engine tags its output with. drawbox and
# drawtext convert their colours with BT.601 on a YUV frame, and the engine stamps BT.709 on every
# segment, so composing in YUV decodes the BEFORE rose a few points off the colour it was given.
TO_BT709 = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
BT709_TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]

# The template's copy inputs, filled from the content file.
FIELD_NAMES = ("ticket", "headline", "summary", "beforeBadge", "afterBadge", "beforeChip", "afterChip",
               "outroHeadline", "outroSubtitle")
# HTML layers are drawn by Satori at the weight their CSS asks for (Rubik 400, Oswald 400), while
# wrap.py measures the font file's default instance (Rubik Light). Heavier weights run a little
# wider, so slate copy must fit 96 % of its box here; `leclap validate` then measures the real
# layout and reports html_overflow, which this script treats as a hard stop too.
HTML_SLACK = 0.96
# The engine findings that mean the slate would not draw as authored.
BLOCKING_FINDINGS = {"html_overflow", "html_missing_field", "html_font_unknown", "html_unavailable",
                     "field_type_mismatch", "field_missing_required"}


class V:
    """Typed accessors over global.variables, so a missing key fails here and not mid-filtergraph."""

    def __init__(self, raw, font_dir, ffmpeg, fps):
        self.raw, self.font_dir, self.ffmpeg, self.fps = raw, pathlib.Path(font_dir), ffmpeg, fps

    def get(self, key):
        if key not in self.raw:
            raise SystemExit(f"template.json: global.variables has no {key!r}")
        return self.raw[key]

    def s(self, key):
        value = self.get(key)
        return value if isinstance(value, str) else value[0]

    def i(self, key, index=None):
        value = self.get(key)
        return int(value if index is None else value[index])

    def f(self, key):
        return float(self.get(key))

    def font(self, key):
        path = self.font_dir / self.s(key)
        if not path.is_file():
            # drawtext does NOT fail on a missing fontfile: it silently falls back to a wide default
            # sans. Checking here is the only way that mistake surfaces.
            raise SystemExit(f"font not found: {path}")
        try:
            cap_height(str(path), 1)  # parse it now, so a woff2 or a collection fails by name
        except ValueError as error:
            raise SystemExit(str(error)) from None
        return str(path)


# Every path this script hands ffmpeg is spliced raw into the filtergraph, where these characters
# are syntax: a colon in --work truncates the option and ffmpeg reports "No option name near …",
# which reads like a filter bug rather than the path problem it actually is.
_FILTER_HOSTILE = frozenset(":,;'\\[]")


def check_filter_path(label, path):
    bad = "".join(sorted(_FILTER_HOSTILE & set(str(path))))
    if bad:
        raise SystemExit(f"{label} contains filtergraph-special character(s) {bad!r}: {path}")


_seq = itertools.count()


def txt(text, font, size, colour, x, baseline, alpha="1", extra="", *, tmp):
    """One `drawtext` line with its BASELINE at `baseline`, its copy passed by FILE rather than inline.

    `text='…'` cannot carry an apostrophe. Not "needs escaping": cannot. `\\'`, `'\\''` and `\\\\'`
    all exit 0 and all render "it's" as "its", dropping the character silently, and one of them also
    swallows `:fontfile=…` so the rest of the filter is drawn on screen as literal text. `textfile=`
    has no quoting layer at all, so every literal this file draws goes through here; `tmp` is
    keyword-REQUIRED so the broken inline form cannot be selected by accident.

    `expansion=none` closes the other half of the same hole: drawtext expands `%{…}` out of a
    textfile exactly as it does inline, so a bare `%` in copy is ffmpeg syntax until switched off.

    drawtext's `y` is the top of the line box, which moves with the font and its size, so two sizes
    given one `y` do not share a baseline. `ascent` is the font's own, the same for every line, so
    `baseline-ascent` puts every face on the grid, accented capitals (É, À) included.
    """
    return (
        f"drawtext=textfile={_tmp_line(text, tmp)}:fontfile={font}:fontsize={size}"
        f":fontcolor={colour}:expansion=none:x={x}:y='{baseline}-ascent':alpha='{alpha}'{extra}"
    )


def _tmp_line(text, tmp):
    # UTF-8 explicitly: write_text() otherwise encodes with the locale's codec, which RAISES on "’"
    # under a POSIX/latin-1 locale and silently emits cp1252 on Windows, while drawtext decodes the
    # file as UTF-8 regardless. The pid keeps two renders sharing one --work from overwriting lines.
    path = tmp / f"_line{os.getpid()}-{next(_seq)}.txt"
    path.write_text(text, encoding="utf-8")
    return path


def stepped_box(x, y, w, h, colour, thickness, t0, t1, fade, fps):
    """A box that fades in at `t0` and out by `t1`. drawbox evaluates its colour once, so the fade is
    a run of boxes, one per frame of each ramp, each behind its own `enable` window."""
    count = max(1, round(fade * fps))
    steps = [(t0 + k / fps, t0 + (k + 1) / fps, (k + 1) / (count + 1)) for k in range(count)]
    steps.append((t0 + count / fps, t1 - count / fps, 1.0))
    steps += [(t1 - (count - k) / fps, t1 - (count - k - 1) / fps, (count - k) / (count + 1)) for k in range(count)]
    return [f"drawbox=x={x}:y={y}:w={w}:h={h}:c={colour}@{alpha:.3f}:t={thickness}"
            f":enable='between(t,{start:.4f},{end:.4f})'" for start, end, alpha in steps]


def probe(ffmpeg, path):
    """Duration and frame size of a capture, read from ffmpeg's own banner so no ffprobe is needed."""
    if not pathlib.Path(path).is_file():
        raise SystemExit(f"capture not found: {path}")
    banner = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    size = re.search(r"Stream #.*?Video:.*?\b(\d{2,5})x(\d{2,5})\b", banner)
    if not size:
        raise SystemExit(f"no video stream in {path}")
    duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", banner)
    if not duration:
        raise SystemExit(f"{path} has no duration header: remux it (ffmpeg -i in -c copy out.mp4) so the "
                         "trim can be checked against its length")
    hours, minutes, secs = duration.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(secs), int(size.group(1)), int(size.group(2))


def pane_fit(v, src_w, src_h):
    """Where a capture lands in its 4:3 pane: a pure scale, never cropped, never stretched. A 4:3
    capture fills the pane exactly; any other shape is letterboxed (or pillarboxed) inside it."""
    pane_w, pane_h = v.i("geom.pane", 0), v.i("geom.pane", 1)
    scale = min(pane_w / src_w, pane_h / src_h)
    fit_w, fit_h = int(src_w * scale) // 2 * 2, int(src_h * scale) // 2 * 2
    return scale, fit_w, fit_h, (pane_w - fit_w) // 2, (pane_h - fit_h) // 2


def check_capture(side, seconds, clip, freeze):
    """Refuse a capture that runs out before its pane does. ffmpeg would not end the pane early: the
    canvas fixes the length and `eof_action=repeat` holds the last frame, so one run would silently
    stand still, which reads as "nothing happens on this side". A freeze past the end is the same gap."""
    trim = float(side["trim"])
    if trim >= seconds:
        raise SystemExit(f"{side['side']}: trim {trim}s is past the end of the {seconds:.2f}s capture "
                         "(trim is a START offset, not a length)")
    need = trim + clip
    if need <= seconds + 1e-3:
        return
    raise SystemExit(f"{side['side']}: the capture holds {seconds:.2f}s but trim {trim}s + clipSeconds {clip}s "
                     f"needs {need:.2f}s ({need - seconds:.2f}s short), so the pane would freeze on its last "
                     f"frame{' before the hold' if freeze else ''}. Lower clipSeconds or the trim.")


def balanced(lines, font, size):
    """Re-break a two-line description where its lines come closest in width, so the second line is
    never one stranded word. Each candidate line is narrower than the greedy first line, so it fits."""
    if len(lines) != 2:
        return lines
    words = " ".join(lines).split()
    splits = [(" ".join(words[:cut]), " ".join(words[cut:])) for cut in range(1, len(words))]
    widest = width(lines[0], font, size)
    candidates = [pair for pair in splits if width(pair[0], font, size) <= widest]
    return list(min(candidates, key=lambda pair: max(width(pair[0], font, size), width(pair[1], font, size))))


def chip(v, x, top, label, colour, *, tmp):
    """A fixed-width badge: BEFORE and AFTER share one width, so what follows them starts on one x."""
    display, size = v.font("font.display"), v.i("size.badge")
    w, h = v.i("geom.chipWidth"), v.i("geom.chipHeight")
    fits(f"{label} chip", label, display, size, w - 2 * v.i("geom.chipGap"))
    baseline = top + round((h + cap_height(display, size)) / 2)
    label_x = f"{x}+({w}-text_w)/2"
    return [f"drawbox=x={x}:y={top}:w={w}:h={h}:c={colour}@1:t=fill",
            txt(label, display, size, v.s("colour.ink"), label_x, baseline, tmp=tmp)], baseline


def comparison(v, out, sides, work, clip, freeze, ticket, tmp):
    """The two runs in two 4:3 panes with their labels, the hold baked in, written as one clip.

    The hold is baked HERE (both panes loop the frame at `at` for `hold` seconds) rather than left to
    the engine's `options.freeze`: that would freeze the whole frame, labels included, so a callout
    drawn into this clip could never appear during the hold."""
    canvas_w, canvas_h, fps = v.i("geom.canvas", 0), v.i("geom.canvas", 1), v.fps
    pane_w, pane_h, pane_y, gap = v.i("geom.pane", 0), v.i("geom.pane", 1), v.i("geom.paneY"), v.i("geom.labelGap")
    display, body, mono = v.font("font.display"), v.font("font.body"), v.font("font.mono")
    vocabulary = v.get("limit.badgeVocabulary")
    hold = float(freeze["hold"]) if freeze else 0.0
    total = clip + hold
    loop = (f",loop=loop={round(hold * fps)}:size=1:start={round(float(freeze['at']) * fps)},setpts=N/({fps}*TB)"
            if freeze else "")

    cmd = [v.ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    graph, last, fits_by_side = [], f"[{len(sides)}:v]", {}
    for index, side in enumerate(sides):
        seconds, src_w, src_h = probe(v.ffmpeg, work / side["capture"])
        check_capture(side, seconds, clip, freeze)
        scale, fit_w, fit_h, off_x, off_y = pane_fit(v, src_w, src_h)
        fits_by_side[side["side"]] = (scale, off_x, off_y, src_w, src_h)
        cmd += ["-ss", f"{float(side['trim']):.3f}", "-t", f"{clip:.3f}", "-i", str(work / side["capture"])]
        graph.append(f"[{index}:v]fps={fps},scale={fit_w}:{fit_h}:flags=lanczos,setsar=1,format=rgb24,"
                     f"pad={pane_w}:{pane_h}:{off_x}:{off_y}:{v.s('colour.letterbox')}{loop}[p{index}]")
        graph.append(f"{last}[p{index}]overlay={v.i('geom.paneX', index)}:{pane_y}:eof_action=repeat[o{index}]")
        last = f"[o{index}]"
        print(f"  {side['side']} pane: capture {src_w}x{src_h} → {fit_w}x{fit_h}"
              + (f" (letterboxed {off_x},{off_y})" if (off_x, off_y) != (0, 0) else ""))
    cmd += ["-f", "lavfi", "-i", f"color=c={v.s('colour.canvas')}:s={canvas_w}x{canvas_h}:r={fps}:d={total}"]

    margin, header = v.i("geom.margin"), v.i("geom.headerBaseline")
    signature = "Made with LeClap"
    sig_w = fits("signature", signature, mono, v.i("size.signature"), canvas_w / 2)
    ticket_x = margin + v.i("geom.markSize") + 12
    fits("ticket", ticket, mono, v.i("size.ticket"), canvas_w - ticket_x - sig_w - 2 * margin)
    # The mark itself is an engine image input at margin:margin, so it is the same file as the slate's.
    draw = ["format=rgb24",
            txt(ticket, mono, v.i("size.ticket"), v.s("colour.brand"), ticket_x, header, tmp=tmp),
            txt(signature, mono, v.i("size.signature"), v.s("colour.muted"), round(canvas_w - margin - sig_w),
                header, tmp=tmp)]
    chip_top = pane_y - gap - v.i("geom.chipHeight")
    for index, side in enumerate(sides):
        if side["badge"] not in vocabulary:
            raise SystemExit(f"badge {side['badge']!r} not in {vocabulary}: the chip has no room to wrap")
        pane_x, accent = v.i("geom.paneX", index), v.s(f"colour.{side['side']}")
        boxes, baseline = chip(v, pane_x, chip_top, side["badge"], accent, tmp=tmp)
        title_x = pane_x + v.i("geom.chipWidth") + v.i("geom.chipGap")
        title_room = pane_w - (title_x - pane_x)
        title_w = fits(f"{side['side']} title", side["title"], display, v.i("size.title"), title_room)
        desc = balanced(wrap_checked(f"{side['side']} desc", side["desc"], body, v.i("size.desc"), pane_w,
                                     max_lines=v.i("limit.descLines")), body, v.i("size.desc"))
        draw += [f"drawbox=x={pane_x - 1}:y={pane_y - 1}:w={pane_w + 2}:h={pane_h + 2}"
                 f":c={v.s('colour.divider')}@1:t=1",
                 *boxes,
                 txt(side["title"], display, v.i("size.title"), v.s("colour.fg"), title_x, baseline, tmp=tmp),
                 *(txt(line, body, v.i("size.desc"), v.s("colour.muted"), pane_x,
                       v.i("geom.descBaselines", number), tmp=tmp) for number, line in enumerate(desc))]
        callout = side.get("callout") if freeze else None
        note = ""
        if callout:
            mark, stroke, mark_gap = (v.i("geom.calloutMark", k) for k in range(3))
            size = v.i("size.callout")
            room = title_room - title_w - v.i("geom.calloutGap") - mark - mark_gap
            callout_w = fits(f"{side['side']} callout", callout, mono, size, room)
            # Right-aligned on the title row, never over the capture. It fades in just after the hold
            # starts and is gone when the runs move again; the square is the highlight's shape and colour.
            t0 = round(float(freeze["at"]) + v.f("motion.calloutDelay"), 3)
            t1 = round(float(freeze["at"]) + hold, 3)
            fade = v.f("motion.calloutFade")
            callout_x = pane_x + pane_w - round(callout_w)
            mark_x = callout_x - mark_gap - mark
            mark_y = round(baseline - cap_height(mono, size) / 2 - mark / 2)
            alpha = f"min(clip((t-{t0})/{fade},0,1),clip(({t1}-t)/{fade},0,1))"
            draw += stepped_box(mark_x, mark_y, mark, mark, accent, stroke, t0, t1, fade, fps)
            draw.append(txt(callout, mono, size, accent, callout_x, baseline, alpha,
                            f":enable='between(t,{t0},{t1})'", tmp=tmp))
            note = f" · callout {round(callout_w)}px of {round(room)}px"
        print(f"  {side['side']} labels: badge {side['badge']} · title {round(title_w)}px of {title_room}px"
              f" · desc {len(desc)}L{note}")

    graph.append(f"{last}{','.join(draw)},{TO_BT709}[v]")
    cmd += ["-filter_complex", ";".join(graph), "-map", "[v]", "-t", f"{total:.3f}", "-r", str(fps), "-an",
            "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", *BT709_TAGS, str(out)]
    subprocess.run(cmd, check=True)
    return fits_by_side


def highlight(v, index, side, fitted, freeze):
    """An engine `frame` stroke around the changed area of pane `index`, shown only while the runs are
    held. It fades rather than traces: the point is where it is, not how it arrives."""
    area = side["highlight"]
    scale, off_x, off_y, src_w, src_h = fitted
    if area["x"] < 0 or area["y"] < 0 or area["x"] + area["w"] > src_w or area["y"] + area["h"] > src_h:
        raise SystemExit(f"sides[{side['side']}].highlight {area} is outside the {src_w}x{src_h} capture "
                         "(it is in capture pixels)")
    clearance, radius, thickness = (v.i("geom.highlight", k) for k in range(3))
    at, hold = float(freeze["at"]), float(freeze["hold"])
    return {
        "type": "frame",
        "at": round(at + v.f("motion.calloutDelay"), 3),
        "until": round(at + hold, 3),
        "target": {
            "x": round(v.i("geom.paneX", index) + off_x + area["x"] * scale),
            "y": round(v.i("geom.paneY") + off_y + area["y"] * scale),
            "w": round(area["w"] * scale),
            "h": round(area["h"] * scale),
        },
        "clearance": clearance,
        "radius": radius,
        "thickness": thickness,
        "trace": "fade",
        "exit": "fade",
        "contrast": "shadow",
        "color": v.s(f"colour.{side['side']}"),
    }


def keys(obj, where, required, optional=()):
    """Reject a content object with missing or unknown keys; `_`-prefixed keys are notes."""
    if not isinstance(obj, dict):
        raise SystemExit(f"content: {where} must be an object")
    missing = [key for key in required if key not in obj]
    if missing:
        raise SystemExit(f"content: {where} is missing {', '.join(missing)} (see content.example.json)")
    unknown = sorted(key for key in obj if key not in required and key not in optional and not key.startswith("_"))
    if unknown:
        raise SystemExit(f"content: {where} has unknown key(s) {', '.join(unknown)}: nothing draws them")


def pick(value, where, locale):
    """Copy is a string, or {locale: string} like LeClap's own translated fields."""
    text = value
    if isinstance(value, dict):
        if locale not in value:
            raise SystemExit(f"content: {where} has no {locale!r} copy (has {', '.join(value) or 'none'})")
        text = value[locale]
    if not isinstance(text, str) or not text.strip():
        raise SystemExit(f"content: {where} must be non-empty copy")
    return " ".join(text.split())


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def load_content(path, locale):
    """The content file, checked key by key and with every string picked for `locale`."""
    raw = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    keys(raw, "the file", required=("ticket", "summary", "intro", "outro", "sides"),
         optional=("clipSeconds", "freeze"))
    keys(raw["intro"], "intro", required=("headline",))
    keys(raw["outro"], "outro", required=("headline", "subtitle"))
    freeze = raw.get("freeze")
    if freeze is not None:
        keys(freeze, "freeze", required=("at", "hold"))
    sides = raw["sides"] if isinstance(raw["sides"], list) else []
    names = [side.get("side") for side in sides if isinstance(side, dict)]
    if names != ["before", "after"]:
        raise SystemExit(f"content: sides must be before then after, got {names}")

    def copy(value, where):
        return pick(value, where, locale)

    picked = []
    for side in sides:
        where = f"sides[{side['side']}]"
        needs_highlight = ("highlight",) if freeze else ()
        keys(side, where, required=("side", "badge", "capture", "trim", "chip", "pane", *needs_highlight),
             optional=("highlight", "callout"))
        keys(side["pane"], f"{where}.pane", required=("title", "desc"))
        if not number(side["trim"]) or side["trim"] < 0:
            raise SystemExit(f"content: {where}.trim is the START offset into the capture, in seconds (>= 0)")
        if "highlight" in side:
            keys(side["highlight"], f"{where}.highlight", required=("x", "y", "w", "h"))
            if not all(number(side["highlight"][k]) for k in "xywh") or min(side["highlight"][k] for k in "wh") <= 0:
                raise SystemExit(f"content: {where}.highlight is x, y, w, h in capture pixels")
        entry = {"side": side["side"], "capture": side["capture"], "trim": side["trim"],
                 "badge": copy(side["badge"], f"{where}.badge"), "chip": copy(side["chip"], f"{where}.chip"),
                 "title": copy(side["pane"]["title"], f"{where}.pane.title"),
                 "desc": copy(side["pane"]["desc"], f"{where}.pane.desc")}
        if "highlight" in side:
            entry["highlight"] = side["highlight"]
        if "callout" in side:
            entry["callout"] = copy(side["callout"], f"{where}.callout")
        picked.append(entry)
    return {
        "ticket": copy(raw["ticket"], "ticket"),
        "summary": copy(raw["summary"], "summary"),
        "headline": copy(raw["intro"]["headline"], "intro.headline"),
        "outroHeadline": copy(raw["outro"]["headline"], "outro.headline"),
        "outroSubtitle": copy(raw["outro"]["subtitle"], "outro.subtitle"),
        "clipSeconds": raw.get("clipSeconds"),
        "freeze": freeze,
        "sides": picked,
    }


def check_freeze(freeze, clip):
    if freeze is None:
        return
    at, hold = freeze["at"], freeze["hold"]
    if not number(at) or not 0 < at < clip:
        raise SystemExit(f"content: freeze.at={at!r} is outside the {clip}s runs (it is section time, after trim)")
    if not number(hold) or not 2 <= hold <= 10:
        raise SystemExit(f"content: freeze.hold={hold!r} must be 2 to 10 s: the callout has to be found AND read")


def check_slate(v, content):
    """Budget the slate's copy on the same fonts its layers draw with: nothing on the slate wraps."""
    measure = v.i("geom.slateMeasure")
    display, body, mono = v.font("font.display"), v.font("font.body"), v.font("font.mono")
    for name in ("headline", "outroHeadline"):
        fits(name, content[name], display, v.i("size.headline"), measure)
    fits("summary", content["summary"], body, v.i("size.summary"), measure * HTML_SLACK)
    # The slate's field column: a badge, a gap, then the chip copy, in half the measure.
    column = (measure - v.i("geom.margin")) / 2
    room = column - v.i("geom.chipWidth") - v.i("geom.chipGap")
    for side in content["sides"]:
        fits(f"{side['side']} chip copy", side["chip"], body, v.i("size.chip"), room * HTML_SLACK)
    made = spaced("Made with LeClap", mono, v.i("size.signature"), 2)
    fits("outro subtitle", content["outroSubtitle"], body, v.i("size.chip"),
         (measure - made - v.i("geom.margin")) * HTML_SLACK)
    # The slate's ROLL field shares the header row with the mark, LeClap and EVIDENCE (272 px of it).
    roll = spaced(content["ticket"], mono, v.i("size.roll"), 2)
    if roll > measure - v.i("geom.slateHeader"):
        raise SystemExit(f"Overflow: ticket: {roll:.0f}px > {measure - v.i('geom.slateHeader')}px on the slate, "
                         f"{content['ticket']!r}")


def spaced(text, font, size, spacing):
    """Width of a line drawn with CSS letter-spacing, as the slate's mono fields are."""
    return width(text, font, size) + spacing * len(text)


def template_shape(tpl):
    """The sections this script fills: an intro, the side-by-side runs, an outro. Anything else is a
    different video, and the comparison clip would land in no section."""
    named = {section.get("name"): section for section in tpl.get("sections", [])}
    if list(named) != ["intro", "sidebyside", "outro"] or named["sidebyside"].get("type") != "project_video":
        raise SystemExit("template.json: build.py fills sections intro, sidebyside (project_video) and outro; "
                         "this template has a different shape")
    missing = [name for name in (*FIELD_NAMES, "clipSeconds") if name not in tpl["global"].get("fields", {})]
    if missing:
        raise SystemExit(f"template.json: global.fields lacks {', '.join(missing)}")
    return named


_FIELD = re.compile(r"\{\{\s*clipSeconds\s*\}\}")


def resolve(node, clip, locale):
    """Fill `{{ clipSeconds }}` as a number, and give every single-locale `en` text the render locale too."""
    if isinstance(node, list):
        return [resolve(item, clip, locale) for item in node]
    if isinstance(node, str) and _FIELD.fullmatch(node.strip()):
        return clip
    if not isinstance(node, dict):
        return node
    out = {key: resolve(value, clip, locale) for key, value in node.items()}
    if locale != "en" and list(out) == ["en"] and isinstance(out["en"], str):
        out[locale] = out["en"]
    return out


def resolved_template(tpl, content, clip, hold, graphics, locale):
    """The template with this change's copy as field defaults and every timing filled in.

    The copy goes in as `global.fields` defaults, so the engine still type-checks it (maxLength) and
    HTML-escapes it where an HTML layer draws it. `clipSeconds` is filled as a number and dropped:
    `leclap timeline` and `snapshot` assume a 3 s clip for a section whose length is a field."""
    out = resolve(json.loads(json.dumps(tpl)), clip, locale)
    fields = out["global"]["fields"]
    del fields["clipSeconds"]
    values = {**{name: content[name] for name in FIELD_NAMES if name in content},
              **{f"{side['side']}{suffix}": side[key] for side in content["sides"]
                 for suffix, key in (("Badge", "badge"), ("Chip", "chip"))}}
    for name in FIELD_NAMES:
        fields[name]["default"] = values[name]
    runs = next(section for section in out["sections"] if section["name"] == "sidebyside")
    # The hold lengthens the section: a project_video is capped at its declared duration, so without
    # this the freeze would push the end of both runs off the cut instead of extending it.
    runs["options"]["duration"] = round(clip + hold, 3)
    if graphics:
        runs["graphics"] = graphics
    return out


def find_fonts(explicit, names):
    if explicit:
        return pathlib.Path(explicit).resolve()
    candidates = [SKILL_DIR / "fonts", *(parent / LIBRARY_FONTS for parent in SKILL_DIR.parents)]
    for directory in candidates:
        if all((directory / name).is_file() for name in names):
            return directory
    raise SystemExit(f"fonts not found: pass --fonts DIR holding {', '.join(names)} (OFL fonts from LeClap's "
                     "creative kit), or copy them with their licence into ./fonts beside build.py")


def require_drawtext(ffmpeg):
    try:
        filters = subprocess.run([ffmpeg, "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    except FileNotFoundError:
        raise SystemExit(f"ffmpeg not found: {ffmpeg}") from None
    if re.search(r"\sdrawtext\s", filters):
        return
    raise SystemExit(f"{ffmpeg} has no drawtext filter (built without libfreetype), so it cannot draw a "
                     "single label. Point --ffmpeg at one that has it: see SKILL.md, 'The traps'.")


def stage_mark(logo, work):
    """The LeClap mark, unrecoloured, where the slate's HTML layers and the comparison read it."""
    dest = work / "assets" / MARK_ASSET
    dest.parent.mkdir(parents=True, exist_ok=True)
    source = pathlib.Path(logo) if logo else next(
        (parent / LECLAP_MARK for parent in SKILL_DIR.parents if (parent / LECLAP_MARK).is_file()), None)
    if source is None and dest.is_file():
        return
    if source is None:
        raise SystemExit("the LeClap mark was not found: pass --logo apps/leclap-web/public/favicon.svg "
                         "(or pwa-512x512.png) from the LeClap repo")
    if source.suffix.lower() == ".png":
        shutil.copyfile(source, dest)
        return
    if source.suffix.lower() != ".svg":
        raise SystemExit(f"--logo must be the LeClap mark as .svg or .png: {source}")
    if not shutil.which("rsvg-convert"):
        raise SystemExit("--logo is an SVG and rsvg-convert (librsvg) is not installed: pass "
                         "apps/leclap-web/public/pwa-512x512.png instead")
    subprocess.run(["rsvg-convert", "-w", str(MARK_RASTER), str(source), "-o", str(dest)], check=True)


def engine_check(leclap, resolved):
    """`leclap validate` on the resolved template: the engine lays out every HTML layer, so this is
    where a slate line too long for its box (html_overflow) is caught before anything renders."""
    result = subprocess.run([*leclap, "validate", str(resolved), "--json"], capture_output=True, text=True)
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise SystemExit(f"leclap validate failed:\n{result.stdout}{result.stderr}") from None
    findings = [item for value in report.values() if isinstance(value, list) for item in value
                if isinstance(item, dict)]
    blocking = [item for item in findings if item.get("code") in BLOCKING_FINDINGS]
    for item in findings:
        print(f"  validate: {item.get('code')} at {item.get('path')}: {item.get('message')}")
    if not report.get("success") or blocking:
        raise SystemExit("leclap validate refused the resolved template: shorten the copy, never widen the box")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--content", required=True, help="the copy and the two captures (content.example.json)")
    parser.add_argument("--template", default=str(SKILL_DIR / "template.json"))
    parser.add_argument("--work", required=True, help="scratch render root: gets assets/, build/ and "
                                                      "evidence.template.json; capture paths are relative to it")
    parser.add_argument("--fonts", help="TTF/OTF directory (default: ./fonts, then LeClap's creative kit)")
    parser.add_argument("--logo", help="the LeClap mark, .svg or .png (default: the repo's favicon.svg)")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="an ffmpeg WITH drawtext (see SKILL.md)")
    parser.add_argument("--locale", default="en", help="picks {locale: copy} entries; forwarded to the render")
    parser.add_argument("--leclap", help='render with this CLI command, e.g. "npx @leclap/cli"; omit to only '
                                         "build the assets (then use the MCP's compose_video)")
    parser.add_argument("--out", help="rendered file (default: <work>/<ticket>-evidence.mp4)")
    return parser.parse_args()


def main():
    # Line-buffered, so these notes interleave with the CLI's own output when piped to an agent.
    sys.stdout.reconfigure(line_buffering=True)
    args = parse_args()
    tpl = json.loads(pathlib.Path(args.template).read_text(encoding="utf-8"))
    template_shape(tpl)
    content = load_content(args.content, args.locale)
    variables = tpl["global"]["variables"]
    fonts = find_fonts(args.fonts, [variables[key] for key in ("font.display", "font.body", "font.mono")])
    v = V(variables, fonts, args.ffmpeg, tpl["global"].get("fps", 30))
    require_drawtext(args.ffmpeg)

    work = pathlib.Path(args.work).resolve()
    videos, lines = work / "assets/videos", work / "build/lines"
    # Scratch copy for `textfile=` lives OUTSIDE assets/: it is never an asset.
    for directory in (videos, lines):
        directory.mkdir(parents=True, exist_ok=True)
    check_filter_path("--fonts", v.font_dir)
    check_filter_path("--work", lines)
    stage_mark(args.logo, work)

    # The clip length is the template's typed clipSeconds field; the content file overrides its default.
    spec = tpl["global"]["fields"]["clipSeconds"]
    clip = content["clipSeconds"] if content["clipSeconds"] is not None else spec["default"]
    if not number(clip) or not spec.get("min", clip) <= clip <= spec.get("max", clip):
        raise SystemExit(f"content: clipSeconds={clip!r} is outside [{spec.get('min')}, {spec.get('max')}]")
    freeze = content["freeze"]
    check_freeze(freeze, clip)

    leclap = shlex.split(args.leclap) if args.leclap else None
    try:
        check_slate(v, content)
        fitted = comparison(v, videos / "sidebyside.mp4", content["sides"], work, clip, freeze,
                            content["ticket"], lines)
    except CopyError as error:
        # The guard working, not an obstacle: shorten the copy. Never widen the box.
        raise SystemExit(f"{type(error).__name__}: {error}") from None
    graphics = [highlight(v, index, side, fitted[side["side"]], freeze)
                for index, side in enumerate(content["sides"]) if freeze and "highlight" in side]
    hold = float(freeze["hold"]) if freeze else 0.0
    resolved = work / "evidence.template.json"
    resolved.write_text(json.dumps(resolved_template(tpl, content, clip, hold, graphics, args.locale), indent=2,
                                   ensure_ascii=False) + "\n", encoding="utf-8")

    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", content["ticket"]).strip("-").lower() or "evidence"
    out = pathlib.Path(args.out).resolve() if args.out else work / f"{slug}-evidence.mp4"
    print(f"Built {videos / 'sidebyside.mp4'} and {resolved}")
    render = ["render", str(resolved), "--assets", str(work / "assets"), "--build", str(work / "build"),
              "--locale", args.locale, "-o", str(out), "--manifest", "--qc"]
    if not leclap:
        paths = json.dumps({"sidebyside": str(videos / "sidebyside.mp4")})
        print(f"Render: leclap {shlex.join(render)}")
        print(f"   or MCP compose_video with template = {resolved.name}, locale {args.locale!r}, userVideoPaths = "
              f"{paths}, the server started with LECLAP_MCP_MEDIA_DIR={work / 'assets'}")
        return
    engine_check(leclap, resolved)
    subprocess.run([*leclap, *render], check=True)


if __name__ == "__main__":
    main()
