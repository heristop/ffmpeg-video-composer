#!/usr/bin/env python3
"""Turn LeClap snapshot sheets (and showcase preview frames) into labelled PR images.

Run by make-media.sh after the `leclap snapshot` calls; needs ffmpeg with libwebp on PATH.
Usage: python3 compose.py [job ...]   (jobs: see JOBS; default: every PR image except the reel sheet)
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = str(Path(__file__).resolve().parents[3])
SNAP = f'{ROOT}/build/pr/snap'
OUT = f'{ROOT}/.github/pr-media/motion-effects'
SHOW = f'{ROOT}/apps/leclap-web/public/videos/showcase'
FONTS = f'{ROOT}/packages/leclap-creative-kit/src/library/fonts'
BG = '0x141416'
W = 1280
TMP = tempfile.mkdtemp(prefix='prmedia-')
os.makedirs(OUT, exist_ok=True)


def run(args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


def textfile(text):
    fd, path = tempfile.mkstemp(dir=TMP, suffix='.txt')
    with os.fdopen(fd, 'w') as f:
        f.write(text)
    return path


def header(title, subtitle):
    """drawtext chain that writes a title band into the top 72 px of a padded image."""
    t = textfile(title)
    s = textfile(subtitle)
    return (
        f"pad=iw:ih+72:0:72:color={BG},"
        f"drawtext=expansion=none:fontfile={FONTS}/Oswald.ttf:textfile={t}:fontcolor=0xF5F3F7:fontsize=30:x=20:y=10,"
        f"drawtext=expansion=none:fontfile={FONTS}/RobotoMono.ttf:textfile={s}:fontcolor=0x9A9AB0:fontsize=15:x=20:y=48,"
        f"drawbox=x=0:y=70:w=iw:h=2:color=0x7C83FD:t=fill"
    )


def finish(src_filter_inputs, chain, name):
    path = f'{OUT}/{name}.webp'
    run([*src_filter_inputs, '-filter_complex', chain, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', path])
    size = os.path.getsize(path) // 1024
    print(f'{name}.webp {size} KB')


def sheet_image(name, sheets, title, subtitle):
    inputs = []
    for s in sheets:
        inputs += ['-i', f'{SNAP}/{s}']
    stack = ''.join(f'[{i}:v]' for i in range(len(sheets)))
    joined = f'{stack}vstack=inputs={len(sheets)}[s];[s]' if len(sheets) > 1 else '[0:v]'
    chain = f'{joined}scale={W}:-2:flags=lanczos,{header(title, subtitle)}'
    finish(inputs, chain, name)


def label(text, size=18, y='h-th-14'):
    t = textfile(text)
    return (
        f"drawtext=expansion=none:fontfile={FONTS}/Oswald.ttf:textfile={t}:fontcolor=white:fontsize={size}:"
        f"box=1:boxcolor=0x000000@0.65:boxborderw=6:x=10:y={y}"
    )


def formats_image():
    cols = [('fmt-landscape', 640, '16:9 landscape'), ('fmt-portrait', 202, '9:16 portrait'), ('fmt-square', 360, '1:1 square')]
    rows = [('frame-01-1.60s.png', 'hook'), (None, 'stat')]
    stat = {'fmt-landscape': 'frame-02-8.40s.png', 'fmt-portrait': 'frame-02-7.40s.png', 'fmt-square': 'frame-02-3.60s.png'}
    inputs, parts, idx = [], [], 0
    for r, (frame, _) in enumerate(rows):
        for c, (folder, width, caption) in enumerate(cols):
            f = frame or stat[folder]
            inputs += ['-i', f'{SNAP}/{folder}/{f}']
            lab = f',{label(caption, 18, "12")}' if r == 0 else ''
            border = 'drawbox=x=0:y=0:w=iw:h=ih:color=0x7C83FD@0.6:t=2'
            parts.append(f'[{idx}:v]scale={width}:360:flags=lanczos,{border}{lab}[c{idx}]')
            idx += 1
    gap = 12
    layout = []
    for r in range(2):
        x = 0
        for c, (_, width, _) in enumerate(cols):
            layout.append(f'{x}_{r * (360 + gap)}')
            x += width + gap
    total_w = sum(w for _, w, _ in cols) + gap * 2
    stack = ''.join(f'[c{i}]' for i in range(idx))
    chain = (
        ';'.join(parts)
        + f';{stack}xstack=inputs={idx}:layout={"|".join(layout)}:fill={BG}[g];'
        + f'[g]pad={W}:ih+24:({W}-{total_w})/2:12:color={BG},'
        + header('One story, three compositions', 'leclap snapshot formats.json --format landscape|portrait|square  (hook and stat beats)')
    )
    finish(inputs, chain, '06-formats')


def showcase_grid():
    cells = [
        ('footage-edit', 0.8, 'fit: blur'),
        ('footage-edit', 3.8, 'focus pan + user LUT'),
        ('footage-edit', 6.5, 'clip + speed ramp'),
        ('footage-edit', 10.0, 'freeze frame + flash'),
        ('footage-edit', 13.2, 'cutaway, LUT at 60%'),
        ('sound-design', 3.5, 'voice: clean + automation'),
        ('sound-design', 6.8, 'auto sfx: riser, drop, boom'),
        ('beat-grid', 1.3, 'beat:n entrances'),
        ('beat-grid', 5.0, 'drop on the beat grid'),
    ]
    inputs, parts = [], []
    for i, (clip, t, cap) in enumerate(cells):
        inputs += ['-ss', str(t), '-i', f'{SHOW}/{clip}.mp4']
        parts.append(f'[{i}:v]trim=end_frame=1,scale=416:234:flags=lanczos,{label(cap, 17)}[c{i}]')
    layout = '|'.join(f'{(i % 3) * 424}_{(i // 3) * 242}' for i in range(len(cells)))
    stack = ''.join(f'[c{i}]' for i in range(len(cells)))
    chain = (
        ';'.join(parts)
        + f';{stack}xstack=inputs={len(cells)}:layout={layout}:fill={BG}[g];'
        + f'[g]pad={W}:ih+16:(ow-iw)/2:8:color={BG},'
        + header('Footage editing and sound design', 'frames from the footage-edit, sound-design and beat-grid showcase previews')
    )
    finish(inputs, chain, '09-footage-audio')


def reel_formats_row():
    """The three formats' hook frames side by side, framed and labelled, as a picture for the reel."""
    cols = [('fmt-landscape', 640, '16:9'), ('fmt-portrait', 202, '9:16'), ('fmt-square', 360, '1:1')]
    inputs, parts = [], []
    for i, (folder, width, caption) in enumerate(cols):
        inputs += ['-i', f'{SNAP}/{folder}/frame-01-1.60s.png']
        border = 'drawbox=x=0:y=0:w=iw:h=ih:color=0x7C83FD:t=3'
        parts.append(f'[{i}:v]scale={width}:360:flags=lanczos,{border},{label(caption, 22, "12")}[c{i}]')
    layout = '0_0|652_0|866_0'
    chain = ';'.join(parts) + f';[c0][c1][c2]xstack=inputs=3:layout={layout}:fill={BG}'
    path = f'{ROOT}/build/pr/assets/pictures/formats-row.png'
    run([*inputs, '-filter_complex', chain, '-frames:v', '1', path])
    print(path)


JOBS = {
    'reel-assets': reel_formats_row,
    'kinetic': lambda: sheet_image('01-kinetic-type', ['kinetic-type/frame-sheet-1.png'], 'Kinetic typography and springs', 'leclap snapshot examples/motion-design/kinetic-type.json --at ... --sheet 3x2'),
    'fx': lambda: sheet_image('02-fx-pack', ['fx-pack/frame-sheet-1.png'], 'Motion FX pack: glitch, rack focus, bars chart, progress, ticker, lower-third styles', 'leclap snapshot examples/motion-design/fx-pack.json --sheet 3x2'),
    'camera': lambda: sheet_image('03-camera-transitions', ['camera/frame-sheet-1.png'], 'Camera rig, animated graphics and designed transitions', 'camera-and-graphics.json: hits, dolly, letterbox bars, zoom-through, iris, swipe'),
    'fills': lambda: sheet_image('04-fills-layouts', ['fills/frame-sheet-1.png', 'split/frame-sheet-1.png'], 'Kinetic fills, split layouts and before/after wipes', 'kinetic-fills.json (gradient, texture, shimmer) + split-layouts.json (triptych, stacked, wipe)'),
    'scripts': lambda: sheet_image('05-captions-rtl-emoji', ['captions/frame-sheet-1.png', 'rtl/frame-sheet-1.png', 'emoji/frame-sheet-1.png'], 'Word-timed captions, right-to-left scripts and emoji', 'word-captions.json (karaoke, crown) + rtl-type.json (Arabic, Hebrew) + emoji-type.json'),
    'formats': formats_image,
    'safe': lambda: sheet_image('07-theme-safe-zones', ['theme-safe/frame-sheet-1.png'], 'Theme tokens, motion roles and TikTok safe zones', 'leclap snapshot theme-roles.json --safe tiktok  (red = covered by the app UI)'),
    'looks': lambda: sheet_image('08-looks', ['looks/compare-grid.png'], 'Every LOOK preset on one frame', 'leclap snapshot split-layouts.json --at 2.4 --looks'),
    'footage': showcase_grid,
    'reel': lambda: sheet_image('10-reel-sheet', ['reel/frame-sheet-1.png'], 'The PR reel at twelve moments', 'leclap snapshot examples/agentic-pr-video/motion-effects-reel.json --at <12 moments> --sheet 4x3'),
}

for job in sys.argv[1:] or [k for k in JOBS if k not in ('reel', 'reel-assets')]:
    JOBS[job]()
