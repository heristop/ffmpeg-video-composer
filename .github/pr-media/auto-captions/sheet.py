# The karaoke contact sheet: the caption band of the render at the middle of eight consecutive spoken
# words, each labelled with the word's pinned window (section seconds).
#   python3 sheet.py <render.mp4> <talk.pinned.json> <RobotoMono.ttf> <out.webp>
import json, subprocess, sys
raw, pinned, font, out = sys.argv[1:5]
OFFSET = 1.5  # the talk section starts after the 1.8 s card minus the 0.3 s fade
words = json.load(open(pinned))['sections'][1]['subtitles']['words']
pick = ['Every', 'word', 'you', 'say', 'becomes', 'caption,', 'speech', 'transcribed']
seen = []
for w in words:
    if w['text'] in pick and w['text'] not in [s['text'] for s in seen]:
        seen.append(w)
inputs, filters = [], []
for i, w in enumerate(seen):
    mid = round((w['start'] + w['end']) / 2, 3)
    inputs += ['-ss', f'{mid + OFFSET:.3f}', '-i', raw]
    label = f"{w['start']:.2f}–{w['end']:.2f} s   “{w['text'].strip(',.')}”"
    label = label.replace(':', '\\:').replace("'", "’")
    filters.append(
        f"[{i}:v]trim=end_frame=1,crop=640:220:40:790,pad=640:262:0:42:color=0x141416,"
        f"drawtext=fontfile={font}:text='{label}':fontsize=22:fontcolor=0xD9D6E4:x=14:y=11[c{i}]"
    )
grid = ''.join(f'[c{i}]' for i in range(len(seen)))
layout = '|'.join(f'{(i % 2) * 640}_{(i // 2) * 262}' for i in range(len(seen)))
filters.append(f"{grid}xstack=inputs={len(seen)}:layout={layout}:fill=0x141416,scale=1120:-1:flags=lanczos[out]")
subprocess.run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(filters), '-map', '[out]',
                '-frames:v', '1', '-c:v', 'libwebp', '-quality', '50', '-compression_level', '6', out], check=True)
