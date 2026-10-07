# Open in builder: hand a template from an agent to a human, with no server

> Status: implemented on `feat/open-in-builder` · Scope: `ffmpeg-video-composer` (link codec),
> `leclap-web` (builder import), `leclap-mcp` (`open_in_builder`), `leclap-cli` (`leclap studio <template>`)

## Why

An agent authors a template over MCP or the CLI; a person then wants to tweak it in the web builder. Hosted
tools solve this by uploading the JSON to their cloud and returning a link. LeClap has no server and should not
grow one. The template itself can travel in the link: compressed, in the URL fragment, which browsers never
send to a server. The static site serves the builder; the descriptor never leaves the two machines.

## Link format

```text
https://leclap.dev/studio/builder#t=v1.<base64url(deflate-raw(JSON))>
```

- `v1.` versions the payload. A decoder refuses an unknown version with a clear message, so the format can
  change later without misreading old links.
- `deflate-raw` through `CompressionStream` / `DecompressionStream` (Node ≥ 18, every current browser). Where
  they are missing (Hermes), a small pure-JS fallback emits stored deflate blocks and inflates any deflate
  stream. No new dependency.
- The route is the builder's real one (`/studio/builder`). A localised base works unchanged
  (`https://leclap.dev/fr` → `/fr/studio/builder`), and `--base http://localhost:5173` targets a dev server.

## Limits

- Hard limit on the encoded payload (512 KiB of base64url): above it the encoder fails with
  `too_large`, telling the author to export the JSON and use the builder's Import instead.
- Warning above 8,000 characters: browsers accept the link, but chat apps, terminals and mail clients may
  truncate it.
- Decoding inflates at most 4 MiB of JSON, so a crafted link cannot exhaust memory.
- Decoding validates the JSON against `TemplateDescriptorSchema`.

## Media

Paths only the author's machine can read cannot travel in a link: absolute or relative file paths, `file:`
and `blob:` URLs, and `media://` uploads from another device. The codec module lists them (`mediaToRebind`);
MCP and the CLI report them next to the link. The builder removes them on import so their scenes open as
empty slots, and lists them in a notice so the user knows what to film or upload again. Library names,
`/assets/…` paths, `http(s)` URLs, `data:` URLs and `media://` keys present in this browser's media store
resolve as usual.

## Surfaces

1. **Codec** (`packages/ffmpeg-video-composer/src/core/template-link/`): pure, no Node imports; exported from
   the Node and browser entries; the web app imports the source directly as it does for the schemas.
2. **Web builder**: `StudioTemplateBuilderPage` reads `#t=`, decodes, validates through the existing JSON
   import path, opens the template as a new unsaved draft (the builder at `/studio/builder` always starts a
   fresh draft and saving creates a new library entry, so nothing is overwritten), then clears the fragment with
   `history.replaceState`. A notice lists media to re-bind; a corrupt, oversized or invalid link shows an
   error notice over an empty builder. i18n in en/fr/de/es/it.
3. **MCP**: `open_in_builder({ template, baseUrl? })` → `{ url, length, mediaToRebind, warnings }`. Pure; no
   file access. No WebMCP counterpart: WebMCP runs inside the builder, where the template is already open.
4. **CLI**: `leclap studio <template> [--open] [--base <url>] [--json]` (`leclap studio open …` is the explicit
   form; the existing `studio status` / `studio pass` gates are unchanged).

## Verification

Codec round trips (unicode, large templates, fallback paths), web import logic and notice render tests (en
keys guarded), MCP tool test, CLI test, then Playwright against a local Vite server: a CLI-generated link for a
bundled template opens with its sections; corrupt and oversized links show the error notice.
