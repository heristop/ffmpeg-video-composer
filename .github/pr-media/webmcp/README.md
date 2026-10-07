# WebMCP: PR media

Media for the WebMCP pull request. The footage is a real recording of the web builder: a browser agent calls the builder's WebMCP tools through the dev polyfill's testing shim while Chrome screencasts the page. The reel around it is a LeClap template rendered by the branch's own CLI.

## Video

| File                       | Caption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`webmcp.mp4`](webmcp.mp4) | WebMCP in the LeClap builder in 70 s (1920×1080, 30 fps, H.264, about 6.7 MB). A title card, then five numbered chapters: the Agent button, edits you can undo (`set_theme`, `add_section` with the new card glowing, `set_format` portrait undone with Ctrl+Z), checking and reviewing (`validate_template`, the activity drawer with Undo), confirmations (`load_sample` declined, `render_preview` allowed, then the preview the page rendered) and the off switch. The outro lists the 23 tools by kind and points to `/doc/webmcp`. A pill in each recording names the tool call and its outcome. Sound: bundled sound effects only. |

The template is [`examples/agentic-pr-video/webmcp-reel.json`](../../../examples/agentic-pr-video/webmcp-reel.json).

## Images

| File                                                   | Caption                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| [`01-title.webp`](01-title.webp)                       | The title card.                                                                           |
| [`02-agent-edit.webp`](02-agent-edit.webp)             | `set_format({ orientation: 'portrait' })` applied to the draft, one undo step.            |
| [`03-activity-undo.webp`](03-activity-undo.webp)       | The Agent drawer: Recent activity, with Undo on the edit that is still the current state. |
| [`04-confirm-declined.webp`](04-confirm-declined.webp) | `load_sample` waits for the user in the page; it is declined (`user_declined`).           |
| [`05-off-switch.webp`](05-off-switch.webp)             | "Let browser agents use this builder" turned off: every tool is removed (`toolchange`).   |
| [`06-tools.webp`](06-tools.webp)                       | The 23 tools: 9 read, 9 edit, 5 consequential.                                            |

Every image is a WebP frame of the CLI's 1280×720 render, under 60 KB.

## Regenerate

From the repository root, with `ffmpeg` (libx264, libwebp), `python3` and `curl` on `PATH`:

```bash
pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
bash .github/pr-media/webmcp/make-media.sh
```

Set `CHROMIUM=/path/to/chrome` if `@playwright/test` has no browser of its own. [`make-media.sh`](make-media.sh) runs these steps; scratch output goes to the git-ignored `build/pr/webmcp/`.

1. Stage the creative-kit `sfx`, `fonts` and `emoji` under `build/pr/webmcp/assets`.
2. If the builder's preview placeholder clips are Git LFS pointers, render them with `apps/leclap-web/scripts/render-placeholder.sh`. The pointers are restored with `git checkout` on exit.
3. Start the web app's dev server on port 5393 and run [`record.mjs`](record.mjs). It opens `/studio/builder?webmcp=polyfill` with `window.__webMCPPolyfillOptions = { installTestingShim: true }`, clicks Start blank and drives the tools with `navigator.modelContextTesting.executeTool`. Each take is a CDP screencast (2× device pixels), written as a 1920×1080 MP4. The tool-call pill and the pointer are an overlay injected by the script, not part of the builder. The script also saves the preview the page rendered with ffmpeg.wasm, because Playwright's Chromium cannot play H.264 in the dialog.
4. Validate, render with `--qc`, and write a review sheet:

   ```bash
   leclap validate examples/agentic-pr-video/webmcp-reel.json
   leclap render examples/agentic-pr-video/webmcp-reel.json --assets build/pr/webmcp/assets --qc -o build/pr/webmcp/webmcp.raw.mp4
   leclap snapshot examples/agentic-pr-video/webmcp-reel.json --at-transitions --per-section --sheet 4x3 --assets build/pr/webmcp/assets --out build/pr/webmcp/review
   ```

5. Delivery encode: the CLI renders landscape at 1280×720 with the `ultrafast` preset (about 12 MB). The delivery file is scaled to 1920×1080 with lanczos and encoded with `libx264 -preset slow -crf 21`, `-shortest` and `+faststart`.
6. [`stills.py`](stills.py) writes the WebP stills from the raw render.

`leclap` stands for `node packages/leclap-cli/dist/index.js`.

## Known issues

- The 1920×1080 file is an upscale: the CLI has no output-size flag, and its landscape preset is 1280×720.
- `--qc` reports `av_drift` (the audio ends 0.2 s after the picture) and warns that most of the audio is silent. The bundled music is a Git LFS pointer, so the reel only has sound effects. The delivery encode trims the audio with `-shortest`.
- Tool timings in the recordings are real, so a new recording can shift a moment by a few frames. `stills.py` and the template's clip ranges leave some margin.
