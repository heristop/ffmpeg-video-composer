# Motion showcase

The web app’s public `/showcase` page brings together every shared app template and the runnable example compositions. The effects tour is the default selected film, listed second after Drink & Code. Its 51 samples include native JSON typography, effects and editing demos, registered Remotion effects, overlays, app demos and review evidence. Search or filter the library, watch a sample, then open **Direction & source** to read its authored creative direction or download the JSON. Shared app templates also open directly in Studio.

The showcase uses the same FilmPlayer and sound/volume controls as the home page. Sound starts muted and can be enabled; narration captions appear only when the film supplies a caption track. Only one film plays at a time. Playback starts on request and pauses when the player leaves the viewport or the tab is hidden. Posters load lazily; previews are 960×540 H.264 at 24 fps with AAC sound when the source has audio, with portrait and square compositions letterboxed. They illustrate the effect with bundled media, synthetic fixtures or the recorded LeClap canvas demo; they are not footage uploaded by a user.

Portrait templates use the bundled portrait source (`video_portrait.mp4`) for every uploaded-video scene, including Story Reel and Present Yourself (Portrait); the renderer selects source footage by template orientation before composition.

Product Launch uses the bundled portrait [Moo Mug product fixture](./media/README.md), with example copy identifying the cow cup.

The Web App Promo preview uses the [recorded LeClap canvas fixture](./media/README.md), replacing the schematic app placeholder. Its typography and perspective are authored in the shared template JSON.

## Effects & editing

The **Effects & editing** category (`effects`) demonstrates the native motion, caption, footage and audio controls. Every sample is a native JSON descriptor under [`examples/motion-design/`](../motion-design/README.md):

| Sample             | What it shows                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `effects-tour`     | The whole vocabulary in ten chapters, every effect named on screen (assembled from chapter renders)               |
| `fx-pack`          | Whip transitions, glitch and rack-focus hits, bar chart, progress bar, ticker, kinetic trails, lower-third styles |
| `word-captions`    | Word-timed captions with karaoke and two caption DNA styles                                                       |
| `formats`          | One story authored for landscape, portrait and square (the landscape cut is previewed)                            |
| `kinetic-fills`    | Gradient, photo-texture and shimmer-sweep fills on kinetic type                                                   |
| `split-layouts`    | `sections[].layout`: a three-pane split, a stacked split and a before/after wipe                                  |
| `rtl-type`         | Arabic and Hebrew kinetic type in the bundled Noto fonts                                                          |
| `emoji-type`       | Colour emoji in kinetic text and a title card                                                                     |
| `beat-grid`        | `global.beats`: bar-length sections, `beat:n` / `bar:n` entrances and hits, a click track of sound effects        |
| `theme-roles`      | A TikTok portrait promo using the neon theme tokens, motion roles and platform safe zones                         |
| `footage-edit`     | Fit blur, focus pan, user LUT, clip range, speed ramp, freeze with flash, B-roll cutaway, look strength           |
| `sound-design`     | Placed and automatic sound effects, a riser into a drop cue, a voice preset and clip volume automation            |
| `html-card`        | A listing reel of HTML and CSS cards (`inputs[].type: "html"`): address and price, stats and chips, agent contact |
| `html-testimonial` | A portrait Reels quote card: mixed weights in one sentence, a round portrait, star rating chips                   |
| `html-speaker`     | A conference opener and speaker lower third: text wordmark, wrapped talk title, time and room badges              |
| `html-stats`       | A square stat dashboard and aligned spec list, with a landscape cut composed by `$format`                         |

`footage-edit` and `sound-design` record their scenes with clips that [`synthetic-media.ts`](./synthetic-media.ts) generates on the fly: the bundled background photographs set in motion by FFmpeg (a slow drift, a push-in, a running clock that makes speed ramps and freezes readable, a waveform over a voice-like test tone). The LUT and B-roll fixtures replace the descriptor's `{{ lut }}` and `{{ broll }}` variables for the preview only; the downloaded JSON keeps its defaults. Those previews illustrate the controls, not real footage.

`effects-tour` plays back its ten chapter templates (`examples/motion-design/effects-tour/`), so its preview runs [`effects-tour.sh --chapters-only`](../motion-design/effects-tour.sh) first: the script generates the same kind of clips, renders every chapter into `build/effects-tour/assets/videos/effects-tour/`, and the preview renders the tour from that staging directory. The downloaded JSON is the assembly; the chapter templates sit next to it in the repository.

## Rebuild previews

Preview rendering uses native `ProjectConfig` for media/fields and the MCP configuration for
registered effects. See [engine configuration](../../docs/engine-configuration.md) and the
[trusted effect startup example](../llm-remotion-title/README.md#custom-product-reveal). The catalog
JSON and exported descriptors do not select executable source. Playback copies are 960×540 at
24 fps; that does not change the registered source composition's 1280×720, 30 fps, ten-second contract.

Use the repository’s pinned Node/pnpm versions, install dependencies, and build the core and MCP packages. System FFmpeg (with `drawtext`) and FFprobe must be available. Registered effects need the existing Remotion/Chromium setup; evidence examples use Playwright from the web app and require its Chromium browser. House evidence cards require Python 3.

```sh
pnpm install
pnpm --filter ffmpeg-video-composer build
pnpm --filter @leclap/mcp build
pnpm --filter @leclap/web exec playwright install chromium
node examples/showcase/render-previews.mjs
```

To regenerate only affected samples:

```sh
node examples/showcase/render-previews.mjs --id type-impact,web-app-promo
```

The renderer reads [`catalog.json`](./catalog.json), uses bundled media, synthetic fixtures and the recorded canvas demo, and writes preview films, real frame posters, source JSON and a hash/duration manifest under `apps/leclap-web/public/videos/showcase/`. Each completed sample updates the manifest, so a failed later render does not lose completed records. Scratch output is under ignored `build/showcase/`; normal web builds consume the committed previews without rendering video.

Shared-template downloads include referenced partials. An overlay sample downloads just its selected scene. Registered effects still require their trusted composition entry and effect catalog; JSON does not package arbitrary executable code. See the [registered effect example](../llm-remotion-title/README.md). House evidence uses the [evidence card builder](../agentic-pr-video/evidence-skill/SKILL.md) to resolve content and media for its preview; its downloaded reusable descriptor retains authoring placeholders.

`meta.creativeDirection` expresses intent and review criteria. Explicit JSON timing, filters and effect props produce the motion; the creative direction text is not interpreted as executable animation instructions. See the [creative-direction guide](../../docs/creative-direction.md).
