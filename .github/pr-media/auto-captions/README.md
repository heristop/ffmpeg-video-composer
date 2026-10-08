# Auto-captions: PR media

Media for the auto-captions pull request. A 9.7 s talking clip is transcribed once on this machine by `leclap transcribe` (whisper.cpp, base model), the words are pinned into the template, and the branch's own CLI renders them as word-by-word karaoke captions. Nothing here was edited by hand after the transcription.

## Video

| File                                       | Caption                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`talk-captions.mp4`](talk-captions.mp4)   | The pinned template rendered by `leclap render` (720×1280, 30 fps, 11.2 s, H.264 + AAC, about 1.3 MB): a title card, then the talk with `boxed` captions, the spoken word in yellow. |
| [`talk-captions.webp`](talk-captions.webp) | The same render as an animated WebP for inline embedding (360×640, 10 fps, from 0.8 s, about 1.3 MB).                                                                                |
| [`talk.mp4`](talk.mp4)                     | The source clip (720×1280, 9.7 s, about 0.6 MB): macOS `say -v Samantha` over a slow zoom on the bundled `cafe-table.jpg` background. This is the only input of the transcription.   |

## Images

| File                                                     | Caption                                                                                                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`karaoke-sheet.webp`](karaoke-sheet.webp)               | Eight consecutive spoken words, each at the middle of its pinned window (section seconds): the highlight walks through "Every word you / say becomes a", then the next phrase.    |
| [`frame.webp`](frame.webp)                               | One full portrait frame: "speech" lit in a two-line boxed caption, inside the TikTok safe zone.                                                                                   |
| [`builder-pinned-words.webp`](builder-pinned-words.webp) | The web builder with the pinned template open: the video scene's Captions panel lists the 30 words, editable in place; the two the recogniser was unsure of (under 0.6) in amber. |

The builder screenshot shows the scene panel only. The builder treats a `video` scene as a slot for the user's own clip, so its canvas is empty. The Expo captions panel is not shown: it needs a device rebuild of the app.

## Text

| File                                       | What it is                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`talk.json`](talk.json)                   | The sample template as authored: portrait (`platform: "tiktok"`), a title card, and a video section with `subtitles.transcribe: { from: "self", language: "en" }`.           |
| [`talk.pinned.json`](talk.pinned.json)     | The same template after `leclap transcribe`: `transcribe` replaced by 30 `words` with confidences, and `meta.resolved.transcripts.talk`.                                     |
| [`transcribe-pin.txt`](transcribe-pin.txt) | The `leclap transcribe` command, its output, and an excerpt of the pin (the first words and `meta.resolved`).                                                                |
| [`talk.srt`](talk.srt)                     | `leclap transcribe talk.mp4 --srt`: the clip's captions as SRT, grouped by the same phrase rules as the render.                                                              |
| [`accuracy.txt`](accuracy.txt)             | What was said against what was pinned: 30 of 30 words (case and punctuation ignored), mean confidence 0.927, word starts within 10 ms of the speech onsets after each pause. |

## Regenerate

From the repository root, with `ffmpeg` (drawtext, libx264, libwebp), `python3` and whisper.cpp (`brew install whisper-cpp`) on `PATH`, and the base model in `~/.cache/leclap/whisper` (`leclap transcribe --download-model` fetches it once):

```bash
pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
bash .github/pr-media/auto-captions/make-media.sh
```

[`make-media.sh`](make-media.sh) pins the words, writes the SRT and the pin excerpt, renders the pinned template, and encodes the MP4, the animated WebP, the contact sheet ([`sheet.py`](sheet.py)) and the still. Scratch output goes to the git-ignored `build/pr/auto-captions/`.

- `REBUILD_CLIP=1` synthesises `talk.mp4` again with macOS `say`. A different voice or OS version gives different audio, so a new digest and slightly different word times.
- `BUILDER=1` also starts the web app's dev server on port 5394 and runs [`builder-still.mjs`](builder-still.mjs). The script opens `/studio/builder?webmcp=polyfill`, loads the pinned template with `replace_template` (allowed in the page), selects the video scene and opens Captions. Set `CHROMIUM=/path/to/chrome` if `@playwright/test` has no browser of its own.
