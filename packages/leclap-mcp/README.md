# @leclap/mcp

An [MCP](https://modelcontextprotocol.io) server that exposes the
[`ffmpeg-video-composer`](../ffmpeg-video-composer) engine as **agent-callable video tools**.

An AI agent (Claude Desktop, Cursor, …) is the LLM; this server helps it **author a customized
template with nice effects** from the schema, then validates and renders it **deterministically** to
an mp4. The server includes the 32 showcase samples through the shared packaged catalog, with
creative direction, descriptors and required inputs. It works without the app or private creative-kit
at runtime. Remotion-assisted authoring is an optional path.
The result is _agent-composable, deterministic, reproducible_ video — the opposite of generative
video models, which sample rather than render.

## Tools

| Tool                   | Description                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_samples`         | Discover sample metadata and required inputs, filtered by category/backend/query → `{ samples }`                                                             |
| `get_sample`           | Get a sample by stable ID → metadata, requirements and self-contained `template` JSON                                                                        |
| `get_template_schema`  | The JSON Schema for a template descriptor + a short authoring guide                                                                                          |
| `validate_template`    | Dry-run an inline descriptor (no render) → `{ valid, sectionCount, orientation, requiredClips, formFields, geometry? }`                                      |
| `compose_video`        | Validate an inline descriptor and render → `{ outputPath, durationSeconds, sizeBytes, videoCodec, audioCodec, renderId }`, plus a `resource_link` to the mp4 |
| `probe_media`          | Inspect a local media file → codecs, duration, sample rate, size                                                                                             |
| `render_remotion_clip` | _(bonus, opt-in)_ Render a composition from **your own** Remotion project → an mp4 clip for a `project_video` section                                        |
| `ping`                 | Liveness check                                                                                                                                               |

Typical agent flow: `list_samples` → `get_sample` → inspect requirements and customize media/copy →
`get_template_schema` → `validate_template` (iterate until valid) → `compose_video` → read the returned
`outputPath`. Author a fresh descriptor from the schema when no sample fits.

`validate_template` also reports, render-free, text that would run off the frame or out of title-safe,
collide with other text, sit under a band, be too small, lack contrast, or sit over footage with no box,
outline or shadow. Those findings arrive on the optional `geometry` field — one line each, saying what to
change, and the field is absent entirely when there is nothing to fix. They are advisory: `valid` stays
`true`. A line ending `(approx: …)` says why it is an estimate: the font could not be read, the text
carries a `{{ variable }}` that only resolves at render time, or a section declares no duration. When a
font is not bundled, the server fetches it from the LeClap asset catalog (5s timeout); offline, it
estimates.

Pass `render: true` to `validate_template` to also render the sections that hold text and measure
their contrast from real pixels — it settles text over images, grades and looks that the render-free
check can only call unknown. It costs seconds (two renders of those sections), goes through the same
media-dir sandbox as `compose_video`, reads assets from the media dir, and runs in the same forked
render worker under the same timeout. It adds a `render` field (`measured`, `seconds`, and
`unavailable` when it could not render — no FFmpeg with `drawtext`, a failed render, or a timeout);
the render-free findings come back either way.

### Discover samples before authoring

Both discovery tools are always available, even with Remotion disabled. They read packaged data only:
no media downloads, effect execution or repository access. `list_samples` accepts optional `category`
(`templates`, `typography`, `app-demos`, `overlays`, `evidence`), `backend` (`native`, `remotion`) and
case-insensitive `query` (up to 4000 characters). `get_sample` takes `id` (1–200 characters).

```json
{ "name": "list_samples", "arguments": { "category": "app-demos", "backend": "native" } }
```

```json
{ "name": "get_sample", "arguments": { "id": "web-app-promo" } }
```

Results include identical JSON in text and `structuredContent`; `get_sample` puts the descriptor at
`template` alongside its metadata. Unknown IDs return `isError` with a discovery hint. Required inputs
include named clips and durations/capture hints, form fields and limits, variables/defaults/placeholders,
assets, effective preset font files (`source: "preset"`) and versioned effects. Replace the sample copy,
supply clips by `userVideoPaths` and form values by `fields`, customize `global.variables`, then pass
`template` to `validate_template` and `compose_video`. Referenced partials are embedded in the descriptor.

The 22 native samples use FFmpeg; the 10 registered effect samples require `--allow-remotion`, Remotion
peers and a trusted `--remotion-entry`. Effects with `customCatalog: true` also require the operator's
`--effect-catalog` and the matching composition in that entry. Sample discovery does not enable execution,
install a catalog or supply React source. Inspect `requirements.setup` and, after operator setup,
`get_effect_schema` before editing effect props. See [operator catalogs](#operator-custom-effect-catalogs).

Preview videos/posters and media are not bundled. Supply or replace authored asset references and fonts;
relative references must resolve under the configured media directory. The `source`, `showcasePath` and
`preview` values describe authoring/showcase locations, not installed local files. To save descriptor JSON
outside MCP, use `leclap samples export <id> --output <new-file>`.

### Recipe: video evidence for a pull or merge request

An agent working on a code change can use LeClap to package visual evidence for review:

1. Collect a short, real screen recording and state what the reviewer should inspect.
2. Author or reuse a review template such as [`examples/agentic-pr-video`](../../examples/agentic-pr-video), or its
   [evidence-video skill](../../examples/agentic-pr-video/evidence-skill), which composes before/after cards and panels
   with measured captions first.
3. Call `validate_template` until the descriptor is valid.
4. Call `compose_video` with the recording in `userVideoPaths` and the review context in `fields`.
5. Attach the returned `outputPath` to the PR or MR beside the diff.

The MCP server renders and returns a local artifact. It **does not upload to GitHub or GitLab**;
that remains an explicit step in the surrounding agent workflow.

**Bring-your-own Remotion (optional).** If you have a Remotion project, `render_remotion_clip` renders
one of its compositions — genuine motion graphics (spring physics, kinetic typography) an FFmpeg
filtergraph can't express — to an mp4. Point it at your `entry` (the module that calls `registerRoot`)
or a prebuilt `serveUrl`, plus a `compositionId` and optional `inputProps`; or set a default with
`--remotion-entry` / `LECLAP_MCP_REMOTION_ENTRY`. Feed the returned clip to `compose_video` as a
`project_video` clip (via `userVideoPaths`) and the deterministic engine composites it in front of your
scenes. It needs the **optional peer deps** `@remotion/renderer` + `@remotion/bundler` and is
**design-time only** (headless Chromium) — everything else in the MCP stays self-contained and on-device.

### Prompt

`compose-video` — a guided authoring prompt (surfaces as `/compose-video` in clients like Claude
Desktop). Takes optional `goal`, `orientation` and `creativeDirection` arguments and primes the agent with the schema,
the premium building-block recipes (which filters give which look, the bundled font list, the
on-device filter allowlist), and the `validate_template` → `compose_video` loop.

`creativeDirection` is a plain-text visual brief (1–4000 characters). The prompt guides the agent to
store it in `meta.creativeDirection`, translate it into explicit native settings or registered effect
props, vary layouts by scene purpose, and inspect entrance, settling and ending against the brief.
`get_template_schema` exposes the metadata contract. It is reference material; the renderer does not
interpret the prose. Registered scenes use `render_preview`; native scenes need an engine render and
frame extraction. These are prompt arguments, not extra `compose_video` arguments. See the
[creative-direction workflow and examples](../../docs/creative-direction.md).

## Run

```bash
# published — no checkout needed
npx -y @leclap/mcp
```

```bash
# or from a checkout: build the engine + this server, then start it over stdio
pnpm --filter ffmpeg-video-composer build
pnpm --filter @leclap/mcp build
node packages/leclap-mcp/dist/index.js
```

It speaks MCP over **stdio** (stdout is the protocol channel — all diagnostics go to stderr).
The published `bin` is `leclap-mcp`.

**FFmpeg.** `compose_video` renders with the engine's FFmpeg: system FFmpeg first, then the bundled
`ffmpeg-static`. `ffmpeg-static` ships no `ffprobe`. Templates with transitions, music, whole-video
overlays or `project_video` clips need one, and so does `probe_media`. On that path a render stops
before encoding and names the missing binary. Installing FFmpeg (`brew install ffmpeg`,
`sudo apt install ffmpeg`) provides both. The optional `ffprobe-static` package, installed next to
the server, also works.

Built on the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
(`@modelcontextprotocol/server`), tracking the current protocol revision. Clients on an older revision
keep working — the stdio entry serves both eras from the same tool definitions.

### Configuration

| Setting                       | Flag                       | Env                                 | Default                                     |
| ----------------------------- | -------------------------- | ----------------------------------- | ------------------------------------------- |
| Output dir                    | `--output-dir`             | `LECLAP_MCP_OUTPUT_DIR`             | `~/.leclap/renders`                         |
| Media allowlist / assets root | `--media-dir`              | `LECLAP_MCP_MEDIA_DIR`              | `~/.leclap/media`                           |
| Remotion opt-in               | `--allow-remotion`         | `LECLAP_MCP_ALLOW_REMOTION`         | Off                                         |
| Stage/worker timeout          | `--render-timeout-ms`      | `LECLAP_MCP_RENDER_TIMEOUT_MS`      | `600000` ms (10 min)                        |
| Trusted Remotion entry        | `--remotion-entry`         | `LECLAP_MCP_REMOTION_ENTRY`         | Unset                                       |
| Chrome executable             | `--remotion-browser`       | `LECLAP_MCP_REMOTION_BROWSER`       | Unset; Remotion manages its browser         |
| Operator effect catalog       | `--effect-catalog`         | `LECLAP_MCP_EFFECT_CATALOG`         | Unset; builtin contracts only               |
| Effect cache bytes            | `--effect-cache-max-bytes` | `LECLAP_MCP_EFFECT_CACHE_MAX_BYTES` | `536870912` (512 MiB); `0` disables caching |

Precedence is flag → environment → default. Paths resolve from the server's working directory;
supplied `~` values are not expanded. A bare `--allow-remotion`, `=true` / `=1`, or environment
`true` / `1` enables Remotion; explicit `=false` / `=0` overrides the environment. Catalog changes
require restart. See the complete [engine configuration reference](../../docs/engine-configuration.md)
for host configuration, output precedence, stage deadlines and cache behavior.

`compose_video` uses `mediaDir` as the engine's `assetsDir` and creates one `buildDir` per render.
Its `fields`, `userVideoPaths` and `locale` arguments bind media/copy; its `template.global` controls
orientation and fps. Codec, quality-tier and FFmpeg segment-concurrency fields are library host
settings, not arbitrary MCP tool arguments.

Eight tools are always registered: `ping`, `list_samples`, `get_sample`, `get_template_schema`,
`validate_template`, `compose_video`, `patch_template` and `probe_media`. Opt-in adds
`get_effect_schema`, `render_preview` and `render_remotion_clip`. Patch availability does not bypass
effect-backend validation.

Each render writes to `<output-dir>/<renderId>/`. Local input files (`userVideoPaths`,
`probe_media`) must resolve **inside** the media-dir (symlink-safe containment check). The
media-dir default is deliberately narrow — pointing it at `~` would let any tool call read the
whole home directory. `render_remotion_clip` executes your project's own JS, so it is registered
only when the opt-in is set (`--allow-remotion` or `LECLAP_MCP_ALLOW_REMOTION=1`); `leclap init
--remotion` scaffolds a `.mcp.json` with it enabled.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (absolute paths only — env values are not tilde-expanded):

```json
{
  "mcpServers": {
    "leclap": {
      "command": "npx",
      "args": ["-y", "@leclap/mcp"],
      "env": {
        "LECLAP_MCP_OUTPUT_DIR": "/abs/path/to/Movies/leclap-renders",
        "LECLAP_MCP_MEDIA_DIR": "/abs/path/to/Movies"
      }
    }
  }
}
```

From a checkout, swap the command for `"command": "node"` with
`"args": ["/abs/path/to/ffmpeg-video-composer/packages/leclap-mcp/dist/index.js"]`.

Then ask the agent to _"compose a 10-second vertical title card with a fade-in and music, then render it"_ —
it fetches the schema, authors a descriptor, validates it, and renders. Open the returned `outputPath`.
Or ask it to list native app demos, retrieve `web-app-promo`, replace the copy and bind your screen recording, then validate and render.

### Inspector

```bash
npx @modelcontextprotocol/inspector node packages/leclap-mcp/dist/index.js
```

## Architecture

`compose_video` never runs the compile in the server process. The core logs to **stdout** during a
render (including pino writing directly to fd 1), which would corrupt the MCP JSON-RPC stream — so
the render runs in a **forked child worker** (`dist/render-worker.js`) and the result returns over
the **IPC channel**, never the child's stdout. This also gives clean error capture (the parent
buffers the worker's logs), render timeouts, and DI state isolation between renders.

`compose_video` returns a **`resource_link`** pointing at the rendered file rather than inlining
megabytes of base64 — the client opens or fetches it. Render progress is written to **stderr**
(`[compose_video] render <id> NN%`), not sent as a protocol notification: the per-request log channel
is deprecated in the current revision, and stdout is reserved for JSON-RPC framing.

Security is inherited from the core: FFmpeg runs via `execFile` (no shell); remote template URLs are
SSRF-guarded (private/metadata IPs + redirects blocked, http(s) only); descriptors are
`safeParse`-validated; local file paths are containment-checked against the media dir.

## Tests

```bash
pnpm --filter @leclap/mcp test              # vitest unit tests (mocked render)
pnpm --filter @leclap/mcp test:integration  # cucumber BDD over real stdio + a real render
```

The integration suite spawns the built server over stdio and renders a self-contained
color-card template end to end — the regression guard proving the stdio framing survives a
real (pino-heavy) compile.

## Not yet (future)

Streamable HTTP transport, MCP resources (`leclap://templates/{name}`), client-visible progress
notifications, remote-URL probing, an async job API.

---

Part of the [LeClap monorepo](../../README.md).

## JSON-first registered effects

The opt-in desktop graphics backend can resolve `type: "effect"` sections directly from JSON before the existing FFmpeg pipeline compiles them. The builtin title effect is `leclap.title-reveal@1.0.0`; configure a trusted Remotion entry exposing `LeclapTitle` (1280×720, 30 fps, 300 frames). [The runnable reference project](../../examples/llm-remotion-title) includes the component, JSON and media fixture generator.

- `get_effect_schema({ list: true })` lists builtin and operator-registered identities, descriptions, output and contract digests. Pass `id` and `version` to inspect strict props/assets; no arguments still returns the builtin title contract. `list: true` cannot be combined with identity fields.
- `validate_template` checks references/props/assets and returns a content-based JSON revision.
- `render_preview` renders selected frames or an inclusive frame range from the effect scene; frame images are readable MCP image content.
- `patch_template` atomically applies selected effect props to inline JSON using an expected revision. Use the expanded section name (including any partial prefix). Effects inside inline partials are editable; editing a registry partial materializes only that reference as an inline partial, preserving its variables and prefix. Other references and the shared definition remain unchanged.
- `compose_video` resolves effect clips and sends the normalized template to the existing engine.

Remotion remains optional and requires the existing trusted-local opt-in. Set `LECLAP_MCP_REMOTION_BROWSER` / `--remotion-browser` to a compatible installed Chrome executable if you want to avoid browser setup downloads. Direct core compilation rejects unresolved effects before platform initialization. Library callers can use the exported `resolveTemplateEffects` callback API with their own trusted renderer.

Registered title effects produce opaque clips. The backend does not execute React scenes on a phone or provide a general effect marketplace. The core's FFmpeg geometry checks do not inspect Remotion graphics for text fit or contrast. Preserve JSON, module source/dependencies, assets and render provenance together for reproducibility.

Registered jobs run in a separate worker under one setup-and-render deadline. Failed jobs are removed. Completed previews retain returned artifacts and provenance; compositions retain provenance after the FFmpeg worker consumes the temporary effect clips. Intermediate paths in `effectProvenance` describe consumed inputs and are not downloadable output artifacts. Relative effect asset paths resolve under `mediaDir`; absolute paths must remain inside it. Effect props/assets must contain concrete values rather than unresolved `{{ placeholders }}`.

Asset preflight shares the effect worker queue, probes videos sequentially, and reuses probe results for the same real file within a request. Its own deadline uses the configured render timeout. Request cancellation and that deadline stop active probes, including FFprobe discovery, before releasing the queue slot.

Registered JSON effect previews and composition reuse rendered artifacts in
`<mediaDir>/.leclap-effects/cache-v1`. Lookup happens after fresh asset staging,
bundling and browser/composition identification. Exact still frames, inclusive
ranges and full clips have separate keys; source, dependencies, props, assets and
render/browser settings participate in provenance. Hits are verified and copied
into the current job directory before use.

The default cache budget is 512 MiB with at most 256 entries, evicted by least
recent use. Oversize outputs bypass admission; cache I/O failures fall back to
rendering. Set `--effect-cache-max-bytes` or `LECLAP_MCP_EFFECT_CACHE_MAX_BYTES`
to a nonnegative safe integer in bytes; `0` disables lookup and publication.
Invalid values use the default. CLI values take precedence over environment values.
Preview results expose `cache: {hits, misses, writes}`; composition results expose
an aggregate `effectCache` when the template contains effects. Individual effect
results also carry `metadata.cache` (`hit`, `miss`, `disabled` or `bypass`).

Each MCP process admits one registered-effect preflight or render job at a time, with at most eight
pending jobs. Queue wait, asset preflight and worker setup/render each have separate
`renderTimeoutMs` deadlines; this is not an end-to-end request budget. Use `1..2147483647` ms for the
effect queue. The final FFmpeg worker has its own render deadline. Independent MCP processes can
reuse the disk cache but do not coalesce rendering jobs. Standalone `probe_media` has a fixed
30-second process timeout and supports request cancellation.

### Web app promo reference

The static effect catalog also includes `leclap.web-app-promo@1.0.0` (`LeclapWebAppPromo`, 1280×720, 30 fps, ten seconds). Discover its strict copy, palette, timing and camera controls through `get_effect_schema`; its local asset slots are `screenshot`, `logo` and `font`. The example Root registers both this composition and the existing title, allowing mixed templates. See [the reference authoring guide](../../examples/llm-remotion-title/README.md#ten-second-web-app-promo) and [promo JSON](../../examples/llm-remotion-title/promo-template.json).

The guide covers screenshot-backed motion, adapting trusted React/SVG layout to frame progress, preview/revision/patch/compose/cache, and an optional ignored snapshot bridge to the supplied private LeClap film source. That bridge reuses selected cinematic effects in the ten-second promo; it does not expose full-film replay or arbitrary source selection through effect JSON.

### Operator custom effect catalogs

Register compositions from your existing trusted Remotion entry with `--effect-catalog /absolute/path/effect-catalog.json` or `LECLAP_MCP_EFFECT_CATALOG` (CLI takes precedence). The server reads and validates the catalog once at startup, keeps an immutable JSON snapshot, and fails startup with an actionable `effect_catalog_invalid` error on invalid input. Restart after changes. Editing or deleting the file while running does not change discovery or prepared jobs. Template JSON cannot select a catalog, entry, source code or output format.

See the [asset-free catalog example](../../examples/llm-remotion-title/effect-catalog.json) and [custom template](../../examples/llm-remotion-title/custom-template.json). Each `schemaVersion: 1` catalog contains `effects` with unique versioned `id`, `version`, `compositionId`, optional `description`, strict `propsSchema`, and `assets`. Builtin identities cannot be overridden. The operator must register the matching composition in the configured entry: JSON describes its contract, while React implements its geometry and animation.

The supported JSON Schema subset is strict objects (`properties`, `required`, `additionalProperties: false`), bounded strings, finite numbers/integers with inclusive bounds, booleans, primitive enums, arrays with one `items` schema and required `maxItems`, descriptions and validated defaults. Unsupported keywords fail closed, including references, unions/combinators, patterns, formats and conditionals. Limits: 256 KiB catalog including normalized defaults, 64 custom effects, schema depth 16 and 1024 total schema nodes; array `maxItems` is at most 1000. JSON traversal is bounded to depth 64 and 20000 nodes. Object/property/asset keys must be safe identifiers, cannot use prototype-related names, and props/asset names cannot overlap.

Each asset declares supported `extensions`, optional `required` (default true), and optional `minVideoDurationSeconds` for video-only extensions. Assets must be regular local files contained by realpath inside `mediaDir`; supplied optional files undergo the same checks. Video minimum duration is explicit for each key. The exact `get_effect_schema` response includes `assetExtensions` and `assetVideoPolicies`; the asset schema lists required slots. Assets use generated staging filenames so case-distinct keys such as `Logo` and `logo` remain separate on case-insensitive filesystems. The builtin title background retains its ten-second minimum. Output remains opaque H.264, landscape 1280×720, 30 fps, 300 frames / ten seconds.

Use `get_effect_schema({ list: true })`, inspect the selected `id`/`version`, validate the inline template, preview real frames, patch bounded props with the returned revision, then compose. The same queue, cancellation/deadline and persistent cache handle custom effects. Prepared jobs carry the resolved composition ID and canonical contract digest across IPC; workers never reread catalog files. Cache provenance includes both values alongside source, assets, props and browser identity. See the [working preview workflow](../../examples/llm-remotion-title/README.md#custom-product-reveal).
