#!/usr/bin/env python3
"""Write the PR stills: WebP frames of the rendered reel (build/pr/webmcp/webmcp.raw.mp4).

Run by make-media.sh after the render; needs ffmpeg with libwebp on PATH. The frames come from the CLI's
1280x720 render (the delivery MP4 is that render scaled to 1920x1080), so no detail is invented.
Usage: python3 stills.py
"""
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / 'build/pr/webmcp/webmcp.raw.mp4'
OUT = ROOT / '.github/pr-media/webmcp'

# (file name, reel second): the title card, an agent edit, the activity drawer, a confirmation, the off
# switch and the tool list. Times follow `leclap timeline examples/agentic-pr-video/webmcp-reel.json`.
STILLS = [
    ('01-title', 4.0),
    ('02-agent-edit', 21.4),
    ('03-activity-undo', 31.0),
    ('04-confirm-declined', 37.6),
    ('05-off-switch', 58.6),
    ('06-tools', 68.0),
]

for name, at in STILLS:
    path = OUT / f'{name}.webp'
    subprocess.run(
        ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(at), '-i', str(RAW), '-frames:v', '1',
         '-c:v', 'libwebp', '-quality', '84', str(path)],
        check=True,
    )
    print(f'{path.name} {os.path.getsize(path) // 1024} KB')
