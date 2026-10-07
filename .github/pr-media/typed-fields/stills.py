#!/usr/bin/env python3
"""Labelled side-by-side stills of the two promo renders (A and B), written as WebP.

Run by make-media.sh after both renders; needs ffmpeg on PATH and Pillow.
Usage: python3 stills.py <a.mp4> <b.mp4> <out-dir>
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
FONTS = ROOT / 'packages/leclap-creative-kit/src/library/fonts'
A_SET = '--set "TITLE=Spring Launch" --set ACCENT=#b8adff --set HOLD=3 --set STYLE=rise'
B_SET = '--set "TITLE=Night Market" --set ACCENT=#ff6f61 --set HOLD=5 --set STYLE=slide-left'
BG = (20, 20, 22)
INK = (245, 243, 247)
MUTED = (154, 154, 176)
EDGE = (74, 74, 88)
W, GAP, PAD = 1280, 16, 16
TILE_W = (W - 2 * PAD - GAP) // 2
TILE_H = TILE_W * 9 // 16
TMP = Path(tempfile.mkdtemp(prefix='typed-fields-'))


def frame(video, at):
    out = TMP / f'{Path(video).stem}-{at}.png'
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-ss', str(at), '-i', video, '-frames:v', '1', str(out)], check=True
    )
    return Image.open(out).convert('RGB').resize((TILE_W, TILE_H), Image.LANCZOS)


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def column_labels(draw, y):
    mono = font('RobotoMono.ttf', 13)
    title = font('Oswald.ttf', 22)
    for i, (name, flags) in enumerate((('A', A_SET), ('B', B_SET))):
        x = PAD + i * (TILE_W + GAP)
        draw.text((x, y), f'Render {name}', font=title, fill=INK)
        draw.text((x, y + 34), flags.replace(' --set', '\n--set').strip(), font=mono, fill=MUTED, spacing=3)
    return y + 34 + 4 * 17 + 10


def sheet(a, b, rows, path):
    label_font = font('Oswald.ttf', 18)
    head = 34 + 4 * 17 + 10 + PAD
    row_h = (28 if any(label for _, label in rows) else 0) + TILE_H + GAP
    img = Image.new('RGB', (W, head + len(rows) * row_h), BG)
    draw = ImageDraw.Draw(img)
    y = column_labels(draw, PAD)
    for at, label in rows:
        if label:
            draw.text((PAD, y), label, font=label_font, fill=MUTED)
            y += 28
        for x, video in ((PAD, a), (PAD + TILE_W + GAP, b)):
            img.paste(frame(video, at), (x, y))
            draw.rectangle((x - 1, y - 1, x + TILE_W, y + TILE_H), outline=EDGE)
        y += TILE_H + GAP
    img = img.crop((0, 0, W, y - GAP + PAD))
    if img.size[1] > W:
        img = img.resize((W * W // img.size[1], W), Image.LANCZOS)
    img.save(path, 'WEBP', quality=80, method=6)
    print(f'{path.name}: {img.size[0]}x{img.size[1]}, {path.stat().st_size // 1024} KB')


def main():
    a, b, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    sheet(a, b, [(1.5, '')], out / '01-same-moment.webp')
    sheet(
        a,
        b,
        [
            (0.25, '0.25 s: the entrance is STYLE (rise vs slide-left)'),
            (1.5, '1.5 s: TITLE and ACCENT filled in the title card'),
            (3.8, '3.8 s: HOLD 3 has handed over to the outro; HOLD 5 still holds the title'),
        ],
        out / '02-three-moments.webp',
    )


if __name__ == '__main__':
    main()
