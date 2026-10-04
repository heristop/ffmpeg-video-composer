"""Measure copy on real glyph advances, so build.py refuses to draw text that would leave its box.

drawtext does not wrap copy into the house template's columns. LeClap's geometry advisories can flag
some risks, but do not prove that copy fits these panels. Measuring here, before ffmpeg runs,
checks the actual glyph advances against the authored text box.

Standard library only. The four TrueType tables a measure needs (head, hhea, hmtx, cmap) are read
directly, so the skill adds no Python dependency. Kerning is ignored on purpose: it only ever narrows
a line, so the measure errs on the side of wrapping one word early. Checked against what drawtext
actually draws on FFmpeg 6.0 and 8.1: within 2 px on a full line.
"""

import struct
from collections import namedtuple
from functools import lru_cache

_Metrics = namedtuple("_Metrics", "upm cmap advances height cap")


class CopyError(Exception):
    """Copy that cannot be drawn as written. Shorten or fix the copy; never widen the box."""


class Overflow(CopyError):
    pass


class MissingGlyph(CopyError):
    pass


def _table_offsets(data, path):
    tag = data[:4]
    if tag in (b"wOF2", b"wOFF"):
        raise ValueError(f"{path} is a web font (woff/woff2); drawtext needs the .ttf/.otf, so convert it first")
    if tag == b"ttcf":
        raise ValueError(f"{path} is a font collection; extract the face you need as a .ttf/.otf")
    if tag not in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        raise ValueError(f"{path} is not a TrueType/OpenType font")

    (count,) = struct.unpack_from(">H", data, 4)
    offsets = {}
    for index in range(count):
        name, _checksum, offset, _length = struct.unpack_from(">4sIII", data, 12 + 16 * index)
        offsets[name.decode("latin-1")] = offset
    return offsets


def _format4(data, at):
    seg_x2 = struct.unpack_from(">H", data, at + 6)[0]
    count = seg_x2 // 2
    ends = struct.unpack_from(f">{count}H", data, at + 14)
    starts = struct.unpack_from(f">{count}H", data, at + 16 + seg_x2)
    deltas = struct.unpack_from(f">{count}h", data, at + 16 + 2 * seg_x2)
    ranges_at = at + 16 + 3 * seg_x2
    ranges = struct.unpack_from(f">{count}H", data, ranges_at)

    mapping = {}
    for index, (start, end, delta, range_offset) in enumerate(zip(starts, ends, deltas, ranges)):
        for code in range(start, min(end, 0xFFFE) + 1):
            glyph = (code + delta) & 0xFFFF
            if range_offset:
                # idRangeOffset is relative to its own slot in the array, per the cmap spec.
                glyph_at = ranges_at + 2 * index + range_offset + 2 * (code - start)
                raw = struct.unpack_from(">H", data, glyph_at)[0]
                glyph = (raw + delta) & 0xFFFF if raw else 0
            if glyph:
                mapping[code] = glyph
    return mapping


def _format12(data, at):
    (groups,) = struct.unpack_from(">I", data, at + 12)
    mapping = {}
    for group in range(groups):
        start, end, first_glyph = struct.unpack_from(">III", data, at + 16 + 12 * group)
        for code in range(start, end + 1):
            mapping[code] = first_glyph + code - start
    return mapping


# Same preference as fontTools' getBestCmap: full Unicode repertoire first, then the BMP.
_CMAP_PREFERENCE = ((3, 10), (0, 6), (0, 4), (3, 1), (0, 3), (0, 2), (0, 1), (0, 0))
_CMAP_PARSERS = {4: _format4, 12: _format12}


def _best_cmap(data, at):
    _version, count = struct.unpack_from(">HH", data, at)
    subtables = {}
    for index in range(count):
        platform, encoding, offset = struct.unpack_from(">HHI", data, at + 4 + 8 * index)
        subtables[(platform, encoding)] = at + offset

    for key in _CMAP_PREFERENCE:
        if key not in subtables:
            continue
        sub_at = subtables[key]
        parser = _CMAP_PARSERS.get(struct.unpack_from(">H", data, sub_at)[0])
        if parser:
            return parser(data, sub_at)
    raise ValueError("no Unicode cmap (format 4 or 12) in the font")


@lru_cache(maxsize=8)
def _metrics(path):
    with open(path, "rb") as handle:
        data = handle.read()
    tables = _table_offsets(data, path)
    missing = [name for name in ("head", "hhea", "hmtx", "cmap") if name not in tables]
    if missing:
        raise ValueError(f"{path} lacks the {', '.join(missing)} table(s) needed to measure text")

    upm = struct.unpack_from(">H", data, tables["head"] + 18)[0]
    ascender, descender, line_gap = struct.unpack_from(">hhh", data, tables["hhea"] + 4)
    long_metrics = struct.unpack_from(">H", data, tables["hhea"] + 34)[0]
    # hmtx holds (advance, lsb) pairs; glyphs past the last pair reuse its advance. For a variable
    # font these are the default instance's advances, which is also the only instance drawtext draws.
    advances = struct.unpack_from(f">{2 * long_metrics}H", data, tables["hmtx"])[0::2]
    # sCapHeight exists from OS/2 version 2 on; older fonts get the usual 70 % of the em.
    cap = round(0.7 * upm)
    if "OS/2" in tables and struct.unpack_from(">H", data, tables["OS/2"])[0] >= 2:
        cap = struct.unpack_from(">h", data, tables["OS/2"] + 88)[0] or cap
    return _Metrics(upm, _best_cmap(data, tables["cmap"]), advances, ascender - descender + line_gap, cap)


def width(text, path, size):
    metrics = _metrics(path)
    total = 0
    for char in text:
        glyph = metrics.cmap.get(ord(char))
        if glyph is None:
            # drawtext would draw the .notdef box: a defect in the frame, not a width question.
            name = path.rsplit("/", 1)[-1]
            raise MissingGlyph(f"{char!r} (U+{ord(char):04X}) is not in {name}; the frame would show a box")
        total += metrics.advances[min(glyph, len(metrics.advances) - 1)]
    return total * size / metrics.upm


def cap_height(path, size):
    """Height of the capitals at `size`: what build.py anchors every line on."""
    metrics = _metrics(path)
    return round(metrics.cap * size / metrics.upm)


def line_height(path, size):
    """The font's own line height at `size`, which is the pitch recent drawtext (6.1+) lays lines on
    before adding line_spacing. FFmpeg 6.0 used the tallest glyph in the text instead, a few px less."""
    metrics = _metrics(path)
    return round(metrics.height * size / metrics.upm)


def wrap(text, path, size, max_px):
    """Greedy wrap on real advance widths. Returns a list of lines."""
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and width(candidate, path, size) > max_px:
            lines.append(current)
            current = word
            continue
        current = candidate
    if current:
        lines.append(current)
    return lines


def fits(label, text, path, size, box_px):
    """Hard budget check: raise rather than render something that runs off the frame."""
    measured = width(text, path, size)
    if measured > box_px:
        raise Overflow(f"{label}: {measured:.0f}px > {box_px:.0f}px budget, {text!r}")
    return measured


def wrap_checked(label, text, path, size, box_px, max_lines=None):
    lines = wrap(text, path, size, box_px)
    for number, line in enumerate(lines, 1):
        # Re-measure each produced line: greedy wrapping cannot split one unbreakable long word.
        fits(f"{label} line {number}", line, path, size, box_px)
    if max_lines and len(lines) > max_lines:
        raise Overflow(f"{label}: {len(lines)} lines > {max_lines} allowed, {text!r}")
    return lines
