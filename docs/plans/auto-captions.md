# Auto-captions: captions from the recorded audio

> Status: phase 1 done (schema, resolve pass, Node whisper.cpp transcriber, `leclap transcribe`, MCP `transcribe_media`);
> phase 2 implemented and compiled for iOS/Android, not yet verified on a device; phase 3: the builder edits pinned words,
> browser transcription is future work; phase 4 docs done (sample template and effects-tour chapter pending).
> Scope: `ffmpeg-video-composer` (schema, resolve pass, advisories), `leclap-cli`,
> `leclap-mcp`, `leclap-expo` (on-device transcription), `leclap-web` (builder) · Prior art: cloud renderers
> that transcribe a referenced clip server-side (`src: "alias://clip"`).

## Why

LeClap's promise is "capture on the phone → effects, music, transitions → render on the phone". Captions are the
missing link: the caption looks, karaoke and safe zones already exist (`subtitles` on any section, see
`docs/template-configuration.md` › Subtitles), but `subtitles` needs `words` (`[{ text, start, end }]`), cues or SRT
that someone supplies. Most short-form video is watched muted, so a talking-head clip without captions loses most
of its audience. Auto-captions turn the clip's own speech into those `words`, privately, on the device.

## The rule: transcribe once, then pin

Transcription is not deterministic across engines, models and OS versions. LeClap's renders are. So transcription
is a **resolve pass**, never part of the render: it writes `words[]` into the descriptor, and the render uses the
pinned words like any authored captions. This is exactly how `global.beats: { analyze: "music" }` works today
(measured on Node, rejected in the browser and on device with `beats_analysis_unavailable`, precomputed with
`leclap beats` / MCP `analyze_music`). Follow that pattern and its code.

## Template shape

```jsonc
"subtitles": {
  "transcribe": { "from": "self", "language": "en" },   // "self" = this section's own clip; or a section name
  "style": "loud",
  "karaoke": "word"
}
```

- `transcribe` and `words`/`cues`/`srt` are mutually exclusive in a resolved template: the resolve pass replaces
  `transcribe` with `words` (keeping `transcribe` in a `meta.resolved` record: engine, model, language, digest of the
  audio, date) so `leclap verify` and the render manifest can tell a pinned transcript apart.
- `language`: BCP-47; omitted = auto-detect where the engine supports it, recorded once detected.
- Words keep the existing contract (`text`, `start`, `end` in section seconds), plus optional `confidence`.

## Where transcription runs

| Surface              | Engine                                                                                                                                                          | Notes                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node: CLI, MCP       | whisper.cpp (MIT) through a small native or WASM binding, or FFmpeg 8's `whisper` audio filter when the FFmpeg build has `--enable-whisper` (detect at runtime) | Model files are downloaded once to a user cache (tiny/base/small), never bundled; checksum-verified.                                                                                                                        |
| Phone: Expo          | iOS `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true`; Android `SpeechRecognizer` with on-device recognition (API 33+, `EXTRA_PREFER_OFFLINE`)     | Native module in `apps/leclap-expo/modules/`. Runs in the app before compile; fills `words` from the OS's per-word timestamps. Fallback (no on-device support): ask the user to type or skip, never send audio to a server. |
| Browser: web builder | Later: whisper in WASM/WebGPU (e.g. transformers.js) behind an explicit "download model" action                                                                 | Out of scope for phase 1; the builder accepts pasted SRT/VTT today.                                                                                                                                                         |

Privacy is the selling point: audio never leaves the device. No cloud speech API, ever.

## Engine and tooling

1. **Schema:** `subtitles.transcribe` (from, language, model hint) with the mutual exclusion above; advisories
   `transcribe_unavailable` (browser/device engine, like `beats_analysis_unavailable`), `transcript_low_confidence`
   (mean confidence under a threshold: suggest reviewing), `transcript_stale` (the section's clip changed since the
   pin: audio digest mismatch).
2. **Resolve pass (Node):** extract the section's audio (16 kHz mono via the existing FFmpeg adapter), run the
   transcriber, map timestamps to section seconds (respect `clip`, `speed`/speed ramps and trims, which already have
   time-mapping helpers in footage lowering), pin `words`. Pure mapping functions are unit-tested; the transcriber
   sits behind an interface with a fake for tests.
3. **CLI:** `leclap transcribe <template|media> [--section name] [--language xx] [--model base] [--json]` writes the
   pinned template (or prints words/SRT for a media file); `leclap render` resolves on the fly when `transcribe` is
   unresolved and a transcriber is available, logging the pin.
4. **MCP:** `transcribe_media` (path → words + SRT + detected language + confidence), and `compose_video` resolving
   `transcribe` before render. Document the "pin, then review" loop for agents.
5. **App (Expo):** after recording/upload, a "Captions" toggle on video steps; transcribe on device, show the words
   for a quick edit (tap a word to fix it), then compile. Store the pinned words in the project.
6. **Builder (web):** show pinned words as editable cues; accept SRT/VTT import; transcription in the browser later.

## Phases

1. Engine schema + resolve pass + Node transcriber (whisper.cpp) + CLI `transcribe` + MCP `transcribe_media`;
   tests with a fixture clip (a short TTS'd sentence) and the fake transcriber.
2. Expo native modules (iOS, Android) + the Captions toggle and word editor; verify on the iOS simulator and the
   Android emulator with a recorded clip; measure time per 30 s of speech.
3. Builder editing of pinned words; browser transcription as an optional download.
4. Docs (template-configuration › Subtitles, MCP/CLI READMEs), a sample template, and a chapter in the effects tour.

## Acceptance

- A recorded talking-head clip on a phone gets word-timed captions with no network, in under ~1× real time on a
  recent device; re-rendering the same project gives identical frames (the words are pinned).
- Node: `leclap transcribe` on the fixture gives ≥ 90 % word accuracy and word timings within ~100 ms.
- Nothing is ever uploaded; model downloads are explicit, cached and checksum-verified.

## Risks

- **Model size / install friction on Node:** download on first use with a clear prompt; offer tiny vs base.
- **OS recogniser differences:** pinning makes renders deterministic; accuracy still varies — the word editor is
  the safety net.
- **Timestamp quality:** OS recognisers give coarser word timings than whisper; karaoke should degrade to phrase
  highlighting when timings are coarse (detect and fall back).
- **Languages:** start with the app's five UI languages (en, fr, de, es, it); RTL captions already exist.
