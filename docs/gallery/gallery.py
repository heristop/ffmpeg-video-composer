#!/usr/bin/env python3
"""Builds the documentation gallery: snapshots every demo template with the LeClap CLI, then tiles the
frames into labelled WebP sheets in docs/media/gallery.

Run through make-gallery.sh (it stages the assets first). Needs ffmpeg (with libwebp) and python3.
Usage: python3 docs/gallery/gallery.py [sheet ...]   (default: every sheet; names are the SHEETS keys)
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TPL = 'docs/gallery/templates'
WORK = ROOT / 'build/gallery'
ASSETS = WORK / 'assets'
SNAP = WORK / 'snap'
OUT = ROOT / 'docs/media/gallery'
FONTS = ROOT / 'packages/leclap-creative-kit/src/library/fonts'
LECLAP = ['node', str(ROOT / 'packages/leclap-cli/dist/index.js')]
BG = '0x141416'
W = 1280
GAP = 8
STRIP = 28
MAX_KB = 150
TMP = tempfile.mkdtemp(prefix='gallery-')


def ffmpeg(args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


def textfile(text):
    fd, path = tempfile.mkstemp(dir=TMP, suffix='.txt')
    with os.fdopen(fd, 'w') as f:
        f.write(text)
    return path


# --- Synthetic footage --------------------------------------------------------------------------------
# Bundled clips are Git LFS objects, so the footage sheets use short clips made from the bundled photos
# (the same idea as examples/showcase/synthetic-media.ts): a drift, a push-in and a running clock.

CLOCK = (
    f"drawtext=fontfile={FONTS}/Oswald.ttf:text='%{{eif\\:t\\:d}}.%{{eif\\:mod(t*100\\,100)\\:d\\:2}} s':"
    'fontsize=72:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14:x=(w-tw)/2:y=(h-th)/2'
)
PUSH_IN = "zoompan=z='1+0.0012*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=640x360:fps=30"
CLIPS = {
    'portrait.mp4': ('green-forest.jpg', "scale=-2:1280,crop=360:640:x='(iw-360)/2':y='(ih-640)*t/8'"),
    'panorama.mp4': ('rocky-coast.jpg', "scale=1920:-2,crop=1920:540:0:'200+8*t'"),
    'timer.mp4': ('golden-hour.jpg', f"scale=800:-2,crop=640:360:x='20*t':y=40,{CLOCK}"),
    'zoom.mp4': ('forest-sea.jpg', f'scale=1280:-2,{PUSH_IN},{CLOCK}'),
    'main.mp4': ('laptop-desk.jpg', f'scale=1280:-2,{PUSH_IN}'),
    'broll.mp4': ('desk-flatlay.jpg', "scale=800:-2,crop=640:360:x='160-20*t':y=40"),
    'sunset.mp4': ('golden-hour.jpg', "scale=800:-2,crop=640:360:x='20*t':y=40"),
    'forest.mp4': ('forest-sea.jpg', "scale=800:-2,crop=640:360:x='20*t':y=60"),
}


def make_clips():
    folder = ASSETS / 'videos/gallery'
    folder.mkdir(parents=True, exist_ok=True)
    for name, (photo, chain) in CLIPS.items():
        if (folder / name).exists():
            continue
        ffmpeg([
            '-loop', '1', '-framerate', '30', '-i', str(ASSETS / 'backgrounds' / photo),
            '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-vf', chain,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30',
            '-c:a', 'aac', '-b:a', '64k', '-t', '8', str(folder / name),
        ])


# --- Snapshots ----------------------------------------------------------------------------------------


def leclap(command, *args):
    """Runs a LeClap command with --json and returns its frames."""
    result = subprocess.run([*LECLAP, command, *args, '--json'], cwd=ROOT, capture_output=True, text=True)
    data = json.loads(result.stdout.strip().splitlines()[-1]) if result.stdout.strip() else {}
    if result.returncode != 0 or data.get('ok') is False:
        sys.exit(f'leclap {command} {" ".join(args)} failed: {data.get("error") or result.stderr}')
    return data


def snapshot(name, template, at, *flags):
    out = SNAP / name
    path = template if template.startswith('examples/') else f'{TPL}/{template}'
    data = leclap('snapshot', path, '--at', ','.join(at), '--assets', str(ASSETS),
                  '--cache', str(WORK / 'cache'), '--out', str(out), *flags)
    return [frame['path'] for frame in data['frames']]


# --- Composition --------------------------------------------------------------------------------------


def header(title, subtitle):
    t, s = textfile(title), textfile(subtitle)
    return (
        f'pad=iw:ih+72:0:72:color={BG},'
        f'drawtext=expansion=none:fontfile={FONTS}/Oswald.ttf:textfile={t}:fontcolor=0xF5F3F7:fontsize=30:x=20:y=10,'
        f'drawtext=expansion=none:fontfile={FONTS}/RobotoMono.ttf:textfile={s}:fontcolor=0x9A9AB0:fontsize=15:x=20:y=48,'
        'drawbox=x=0:y=70:w=iw:h=2:color=0x7C83FD:t=fill'
    )


def tile_chain(index, width, height, label, blend=False, box=None):
    """Scales input `index` to the tile, frames it and writes its label in a strip underneath; `box`
    (x, y, w, h fractions) outlines a region of the tile."""
    t = textfile(label)
    src = f'[{index}:v][{index + 1}:v]blend=all_mode=average,' if blend else f'[{index}:v]'
    region = ''
    if box:
        x, y, w, h = box
        region = f'drawbox=x=iw*{x}:y=ih*{y}:w=iw*{w}:h=ih*{h}:color=0xFFF685:t=3,'
    return (
        f'{src}scale={width}:{height}:flags=lanczos,{region}drawbox=x=0:y=0:w=iw:h=ih:color=0x2E2E38:t=1,'
        f'pad=iw:ih+{STRIP}:0:0:color={BG},'
        f'drawtext=expansion=none:fontfile={FONTS}/RobotoMono.ttf:textfile={t}:fontcolor=0xE6E4EE:fontsize=15:'
        f'y_align=font:x=4:y=h-{STRIP}+5'
    )


def rows_layout(rows):
    """rows: [[(width, height), …], …] → each tile's x_y, centred per row, and the total height."""
    positions, y = [], GAP
    for row in rows:
        row_w = sum(w for w, _ in row) + GAP * (len(row) - 1)
        x = (W - row_w) // 2
        for w, _ in row:
            positions.append(f'{x}_{y}')
            x += w + GAP
        y += max(h for _, h in row) + STRIP + GAP
    return positions, y


def encode(inputs, chain, name):
    path = OUT / f'{name}.webp'
    for quality in (82, 74, 66, 58, 50):
        ffmpeg([*inputs, '-filter_complex', chain, '-frames:v', '1', '-c:v', 'libwebp', '-quality', str(quality), str(path)])
        if path.stat().st_size <= MAX_KB * 1024:
            break
    print(f'{name}.webp  {path.stat().st_size // 1024} KB  (q{quality})')


def compose(name, title, subtitle, rows):
    """rows: [[(frames, label, width, height[, box]), …], …]; `frames` is one path, or two to blend."""
    inputs, parts, sizes, labels = [], [], [], []
    for row in rows:
        sizes.append([(tile[2], tile[3]) for tile in row])
        for frames, label, w, h, *box in row:
            frames = frames if isinstance(frames, list) else [frames]
            index = len(inputs) // 2
            for frame in frames:
                inputs += ['-i', frame]
            labels.append(f'[t{len(parts)}]')
            parts.append(tile_chain(index, w, h, label, len(frames) == 2, box[0] if box else None) + labels[-1])
    positions, height = rows_layout(sizes)
    chain = (
        ';'.join(parts)
        + f';{"".join(labels)}xstack=inputs={len(labels)}:layout={"|".join(positions)}:fill={BG},'
        + f'pad={W}:{height}:0:0:color={BG},{header(title, subtitle)}'
    )
    if len(labels) == 1:
        chain = f'{parts[0]};{labels[0]}pad={W}:{height}:(ow-iw)/2:{GAP}:color={BG},{header(title, subtitle)}'
    encode(inputs, chain, name)


def grid(tiles, cols, aspect=16 / 9):
    """Same-size tiles (frames, label) in `cols` columns."""
    width = (W - GAP * (cols + 1)) // cols
    height = round(width / aspect)
    return [[(f, label, width, height) for f, label in tiles[i:i + cols]] for i in range(0, len(tiles), cols)]


def section_sheet(name, template, cols, moments, title, flags=(), command=None, aspect=16 / 9):
    """One snapshot per (time reference, label); tiled into a labelled grid."""
    frames = snapshot(name, template, [at for at, _ in moments], *flags)
    tiles = list(zip(frames, [label for _, label in moments]))
    extra = f' {" ".join(flags)}' if flags else ''
    command = command or f'leclap snapshot {TPL}/{template} --at <one moment per section>{extra}'
    compose(name, title, command, grid(tiles, cols, aspect))


# --- Sheets -------------------------------------------------------------------------------------------

KINETIC = [
    ('cascade', 0.5), ('rise', 0.4), ('drop', 0.45), ('slide', 0.4), ('pop', 0.55), ('impact', 0.5),
    ('tracking-in', 0.55), ('typewriter', 0.75), ('scramble', 0.5), ('wave', 1.3), ('highlight', 1.6),
    ('counter', 0.7), ('split', 0.55), ('fade', 0.45),
]


def kinetic():
    section_sheet('kinetic-presets', 'kinetic-presets.json', 4,
                  [(f'{p}.start+{t}', f'{p}  (mid-entrance)' if p not in ('highlight', 'wave') else p) for p, t in KINETIC],
                  'Kinetic presets, caught mid-entrance', )


def kinetic_extras():
    section_sheet('kinetic-extras', 'kinetic-extras.json', 3, [
        ('gradient.start+1.6', 'fill.gradient'), ('texture.start+1.6', 'fill.texture'),
        ('sweep.start+1.35', 'fill.sweep (shimmer)'), ('trail.start+0.45', 'trail { echoes: 5 }'),
        ('greedy.start+1.2', 'wrap: greedy'), ('balanced.start+1.2', 'wrap: balanced'),
    ], 'Kinetic fills, trail and balanced wrap')


CAMERAS = ['push-in', 'pull-out', 'drift-left', 'drift-right', 'drift-up', 'drift-down', 'orbit', 'handheld']


def camera():
    at = []
    for c in CAMERAS:
        at += [f'{c}.start+0.05', f'{c}.end-0.05']
    at += ['hits.start+0.9', 'hits.start+1.05']
    frames = snapshot('camera', 'camera-presets.json', at)
    tiles = [([frames[2 * i], frames[2 * i + 1]], f'{c}  (first + last frame)') for i, c in enumerate(CAMERAS)]
    tiles.append(([frames[-2], frames[-1]], 'hits  (before + on the hit)'))
    compose('camera-presets', 'Camera presets: first and last frame of each move, blended',
            f'leclap snapshot {TPL}/camera-presets.json --at <preset>.start+0.05,<preset>.end-0.05', grid(tiles, 3))


GRAPHICS = [
    ('flash', 0.85), ('bars', 1.2), ('underline', 1.2), ('frame', 1.2), ('corners', 1.2), ('wipe', 1.0),
    ('panel', 1.2), ('glitch', 0.75), ('focus', 1.2), ('progress', 1.3), ('ticker', 2.3), ('bars-chart', 1.8),
]


def graphics():
    section_sheet('graphics', 'graphics.json', 4, [(f'{g}.start+{t}', g) for g, t in GRAPHICS],
                  'Graphics: every graphics[] type')


# Each fx primitive near its peak: (section, seconds into it, family).
FX = [
    ('sheen', 0.85, 'light'), ('edge-glow', 1.2, 'light'), ('leak', 1.2, 'light'), ('bloom', 1.2, 'light'),
    ('ripple', 0.75, 'marks'), ('glint', 0.75, 'marks'), ('confetti', 0.75, 'marks'),
    ('bokeh', 1.2, 'ambient'), ('dust', 1.2, 'ambient'), ('vignette-breathe', 1.2, 'ambient'),
    ('grain', 1.2, 'ambient'), ('glass', 1.2, 'surfaces'), ('resolve', 0.75, 'surfaces'),
]


def fx_primitives():
    section_sheet('fx', 'fx.json', 4, [(f'{n}.start+{t}', f'{n}  ({family})') for n, t, family in FX],
                  'Light and effects: every graphics[] fx primitive, near its peak')


STROKES = [('frame', 1.2, 'frame (defaults)'), ('frame-rounded', 1.2, 'frame: radius + path'),
           ('frame-target', 1.2, 'frame: target text:0, split'), ('corners', 1.2, 'corners (defaults)'),
           ('corners-target', 1.2, 'corners: target + spread'), ('corners-round', 1.2, 'corners: radius'),
           ('underline', 1.4, 'underline (defaults)'),
           ('underline-square', 1.4, 'underline: square caps, no settle')]


def strokes():
    section_sheet('strokes', 'strokes.json', 4, [(f'{n}.start+{t}', label) for n, t, label in STROKES],
                  'Strokes: frame, corners and underline, with their defaults and options')


DESIGNED = ['push-left', 'push-right', 'push-up', 'push-down', 'swipe-left', 'swipe-right', 'zoom-through', 'iris',
            'whip-left', 'whip-right', 'whip-up', 'whip-down']


def transitions():
    moments = [(f's{i + 1:02d}.start+0.3', t) for i, t in enumerate(DESIGNED)]
    section_sheet('transitions', 'transitions.json', 4, moments, 'Designed transitions, caught mid-way between two sections',
                  command=f'leclap snapshot {TPL}/transitions.json --at <next section>.start+0.3  (0.6 s transitions)')


def lower_thirds():
    styles = ['band', 'clean-bar', 'side-rule', 'kicker', 'stack-bars', 'pill']
    section_sheet('lower-thirds', 'lower-thirds.json', 3,
                  [(f'{s}.start+1.5', 'band (default)' if s == 'band' else f'style: {s}') for s in styles],
                  'Lower thirds: the default band and every style (lower-left corner)',
                  flags=('--zoom', '0,0.6,0.6,0.4'), aspect=768 / 288)


def title_cards():
    cards = [('left', 'align: left + accent', 0.04), ('center', 'align: center + accent', 0.2),
             ('plain', 'headline + subtitle only', 0.04)]
    tiles = [(snapshot(f'title-{n}', 'title-cards.json', [f'{n}.start+1.6'], '--zoom', f'{x},0.3,0.6,0.42')[0], label)
             for n, label, x in cards]
    compose('title-cards', 'Title cards (cropped to the card)',
            f'leclap snapshot {TPL}/title-cards.json --at <section>.start+1.6 --zoom <x>,0.3,0.6,0.42',
            grid(tiles, 3, 768 / 302))



def html_layers():
    section_sheet('html-layers', 'html-layers.json', 2, [
        ('recipe-card.start+1.5', 'recipe: card'), ('recipe-badge.start+1.5', 'recipe: badge'),
        ('recipe-price-tag.start+1.5', 'recipe: priceTag'), ('recipe-two-column-stat.start+1.5', 'recipe: twoColumnStat'),
    ], 'HTML layers: the four layout recipes of the motion catalog')


def captions():
    styles = ['clean', 'loud', 'keynote', 'documentary', 'boxed', 'neon']
    section_sheet('caption-styles', 'caption-styles.json', 3, [(f'{s}.start+1.3', f'style: {s}') for s in styles],
                  'Caption DNA: the same word-timed line in every style')
    section_sheet('caption-karaoke', 'caption-karaoke.json', 3, [
        ('karaoke-false.start+1.25', 'karaoke: false'), ('karaoke-word.start+1.25', 'karaoke: word'),
        ('karaoke-fill.start+1.25', 'karaoke: fill'), ('karaoke-pop.start+1.1', 'karaoke: pop (on the bump)'),
        ('crown.start+0.9', 'crown: auto, a regular cue'), ('crown.start+3.2', 'crown: auto, the payoff line'),
    ], 'Karaoke modes and the crowned payoff line (loud DNA)')


def layouts():
    splits = [('two-panes', 'split: 2 panes'), ('ratio-0.66', 'ratio 0.66 + divider'), ('three-gap', '3 panes, gap 16'),
              ('four-divider', '4 panes + divider'), ('vertical', 'direction: vertical'),
              ('vertical-ratio', 'vertical, ratio 0.33'), ('vertical-three', 'vertical, 3 panes + gap'),
              ('colour-pane', 'photo + #colour pane')]
    wipes = [(f'wipe-{d}.start+1.2', f'before-after, wipe {d}') for d in ('right', 'left', 'down', 'up')]
    section_sheet('layouts', 'layouts.json', 4, [(f'{n}.start+1', label) for n, label in splits] + wipes,
                  'Layouts: split screens and before/after wipes (mid-wipe)')


THEMES = ['leclap', 'midnight', 'editorial', 'bold', 'neon', 'paper', 'sunset', 'ocean', 'mono', 'candy', 'retro',
          'corporate']


def themes():
    data = leclap('compare', *[f'{TPL}/themes/{t}.json' for t in THEMES], '--at', '1', '--assets', str(ASSETS),
                  '--cache', str(WORK / 'cache'), '--out', str(SNAP / 'themes'))
    tiles = [(frame['path'], f'theme: {t}') for frame, t in zip(data['frames'], THEMES)]
    compose('themes', f'Built-in themes: one card, {len(THEMES)} palettes and type stacks',
            f'leclap compare {TPL}/themes/*.json --at 1', grid(tiles, 3))


PLATFORMS = [('tiktok', 'portrait'), ('reels', 'portrait'), ('shorts', 'portrait'), ('square-feed', 'square'),
             ('youtube', 'landscape'), ('x', 'landscape'), ('linkedin', 'landscape'), ('facebook', 'landscape')]


def platforms():
    frames = {p: snapshot(f'safe-{p}', 'platform-safe.json', ['1'], '--format', f, '--safe', p)[0] for p, f in PLATFORMS}
    tall = 330
    top = [(frames[p], p, round(tall * 9 / 16) if p != 'square-feed' else tall, tall) for p, _ in PLATFORMS[:4]]
    width = (W - GAP * 5) // 4
    bottom = [(frames[p], p, width, round(width * 9 / 16)) for p, _ in PLATFORMS[4:]]
    compose('platforms', 'Platform safe zones (shaded: covered by the app UI)',
            f'leclap snapshot {TPL}/platform-safe.json --at 1 --format <orientation> --safe <platform>', [top, bottom])


def formats():
    template = 'examples/motion-design/formats.json'
    shots = {f: snapshot(f'fmt-{f}', template, at, '--format', f)
             for f, at in [('landscape', ['1.6', '8.4']), ('portrait', ['1.6', '7.4']), ('square', ['1.6', '3.6'])]}
    tall = 300
    sizes = {'landscape': round(tall * 16 / 9), 'portrait': round(tall * 9 / 16), 'square': tall}
    rows = [[(shots[f][i], f'{f} · {beat}', sizes[f], tall) for f in shots] for i, beat in enumerate(['hook', 'stat'])]
    compose('formats', 'Formats: one story, three compositions',
            'leclap snapshot examples/motion-design/formats.json --format landscape|portrait|square', rows)


def looks():
    data = leclap('snapshot', f'{TPL}/looks.json', '--at', '1', '--looks', '--assets', str(ASSETS),
                  '--cache', str(WORK / 'cache'), '--out', str(SNAP / 'looks'))
    tiles = [(frame['path'], frame['label']) for frame in data['frames']]
    compose('looks', f'Every LOOK preset ({len(tiles) - 1} + the authored frame)',
            f'leclap snapshot {TPL}/looks.json --at 1 --looks', grid(tiles, 6))
    moments = [(f'{p}-{s}.start+0.8', f'{p} · strength {s}') for p in ('teal-orange', 'mono-film') for s in (0.25, 0.5, 1)]
    section_sheet('look-strength', 'look-strength.json', 3, moments, 'LUT looks dialled with look.strength')


def emoji_rtl():
    section_sheet('emoji', 'emoji.json', 2, [
        ('kinetic.start+1.5', 'kinetic block'), ('sequence.start+1.5', 'skin tone, flag, ZWJ, keycap'),
        ('title-card.start+1.6', 'title card'), ('lower-third.start+1.5', 'lower third (pill)'),
    ], 'Colour emoji in every text element')
    section_sheet('rtl', 'rtl.json', 2, [
        ('arabic.start+1.5', 'Arabic (noto-arabic)'), ('hebrew.start+1.5', 'Hebrew (noto-hebrew)'),
        ('mixed.start+1.6', 'Arabic + Hebrew + Latin'), ('caption.start+1.5', 'Hebrew caption'),
    ], 'Right-to-left scripts', flags=('--locale', 'he'))


def footage():
    section_sheet('footage-framing', 'footage-framing.json', 3, [
        ('cover.start+0.8', 'fit: cover (portrait clip)'), ('letterbox.start+0.8', 'fit: letterbox'),
        ('blur.start+0.8', 'fit: blur'), ('focus-left.start+0.8', 'focus: left (wide clip)'),
        ('focus-center.start+0.8', 'focus: center'), ('focus-right.start+0.8', 'focus: right'),
    ], 'Footage: fit and focus (synthetic clips)')
    ramps = [('no-ramp', 2.0), ('hero', 2.4), ('montage', 1.0), ('bullet', 2.6), ('flash-in', 0.5), ('flash-out', 3.2)]
    moments = [(f'{r}.start+{t}', f'{"no ramp" if r == "no-ramp" else "speedRamp: " + r} · t={t} s') for r, t in ramps]
    moments += [('freeze.start+1.6', 'freeze: held frame (+ flash)'), ('cutaway.start+1.4', 'cutaway (B-roll over main)')]
    section_sheet('footage-timing', 'footage-timing.json', 4, moments,
                  'Footage retiming: the burnt-in clock is the source time at section time t')


def tooling():
    files = [f'{TPL}/compare/{n}.json' for n in ('calm', 'default', 'hype')]
    data = leclap('compare', *files, '--at', '0.5', '--cols', '3', '--assets', str(ASSETS),
                  '--cache', str(WORK / 'cache'), '--out', str(SNAP / 'compare'))
    grid_png = data['sheet']['path']
    compose('snapshot-compare', 'leclap compare: one moment of several templates in one grid',
            f'leclap compare {TPL}/compare/calm.json default.json hype.json --at 0.5 --cols 3',
            [[(grid_png, 'compare-grid.png (as written by the CLI)', W - 2 * GAP, round((W - 2 * GAP) * data['sheet']['height'] / data['sheet']['width']))]])
    zoom = (0.2, 0.35, 0.6, 0.6)
    flag = ','.join(str(v) for v in zoom)
    full = snapshot('zoom-full', 'graphics.json', ['bars-chart.start+1.8'])[0]
    crop = snapshot('zoom-crop', 'graphics.json', ['bars-chart.start+1.8'], '--zoom', flag)[0]
    width = (W - GAP * 3) // 2
    height = round(width * 9 / 16)
    compose('snapshot-zoom', 'leclap snapshot --zoom: crop a region to check the detail',
            f'leclap snapshot {TPL}/graphics.json --at bars-chart.start+1.8 --zoom {flag}',
            [[(full, 'full frame (yellow: the zoom region)', width, height, zoom), (crop, f'--zoom {flag}', width, height)]])


SHEETS = {
    'kinetic': kinetic, 'kinetic-extras': kinetic_extras, 'camera': camera, 'graphics': graphics,
    'fx': fx_primitives, 'strokes': strokes,
    'transitions': transitions, 'lower-thirds': lower_thirds, 'title-cards': title_cards, 'html-layers': html_layers,
    'captions': captions,
    'layouts': layouts, 'themes': themes, 'platforms': platforms, 'formats': formats, 'looks': looks,
    'emoji-rtl': emoji_rtl, 'footage': footage, 'tooling': tooling,
}

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    make_clips()
    for key in sys.argv[1:] or SHEETS:
        SHEETS[key]()
