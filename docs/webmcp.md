# Browser agents (WebMCP)

The web template builder (`/studio/builder`, `/templates/new`, `/templates/:id/edit`) registers its tools
with the AI agent built into your browser through [WebMCP](https://github.com/webmachinelearning/webmcp).
The agent reads the open draft, validates it and edits it step by step, with every edit undoable, using
your browser's own model. The page holds no API key. The web page version of this guide is
[/doc/webmcp](https://leclap.dev/doc/webmcp).

A 70-second walkthrough of a real session is in [`.github/pr-media/webmcp/`](../.github/pr-media/webmcp/README.md)
([`webmcp.mp4`](../.github/pr-media/webmcp/webmcp.mp4)).

## Turn it on

- **Browser.** WebMCP exposes `document.modelContext`. Chrome ships it as an origin trial. For local work,
  turn on `chrome://flags/#enable-webmcp-testing`. A deployment that registered for the trial sets
  `VITE_WEBMCP_OT_TOKEN` at build time, and every page then gets the trial's
  `<meta http-equiv="origin-trial">` tag (`apps/leclap-web/vite/webmcp-origin-trial.ts`).
  `public/_headers` sends `Permissions-Policy: tools=(self)`, so only this origin's frames can register
  tools.
- **The Agent button.** When the browser offers WebMCP, an **Agent** button appears in the builder's
  titlebar, with a dot for its state: off, ready or working. The button opens a drawer (right side on wide
  screens, bottom sheet on phones). The drawer holds:
  - **Let browser agents use this builder**, on by default. Turning it off removes every tool at once, so
    the agent gets a `toolchange` event.
  - **Ask before every edit**: each edit waits for your OK.
  - **Recent activity**: each call with its outcome. An edit that is still the current state has an
    **Undo** button.
- **Feedback.** Changed scene cards glow briefly, and a polite live region announces a summary.
- **Settings** persist in `localStorage['leclap.webmcp.v1']`. `VITE_WEBMCP=0` removes the feature from a
  build.
- **Development polyfill.** In a dev build (or a build with `VITE_WEBMCP_POLYFILL=1`), add
  `?webmcp=polyfill` to load `@mcp-b/webmcp-polyfill`. With `window.__webMCPPolyfillOptions =
{ installTestingShim: true }` it also adds `navigator.modelContextTesting`. Production never loads it.

## Try it

1. Turn on `chrome://flags/#enable-webmcp-testing` (or use a deployment with the origin trial) and restart
   Chrome.
2. Open the builder: **Build from scratch** (`/studio/builder`), a new template or a template's editor.
   The **Agent** button shows up in the titlebar.
3. Ask your browser's agent to work on the open template, for example "list the scenes, then set a darker
   theme". Each call shows up under **Recent activity**, and changed scene cards glow.
4. Undo any edit from the drawer or with Ctrl/Cmd+Z. Ask for a preview or a save to see the confirmation.

## Tools

The builder registers 23 tools: 9 read, 9 edit and 5 consequential. Names and kinds live in
`apps/leclap-web/src/application/usecases/webmcp/tool-names.ts`; the registry
(`registry.ts`) applies each kind's confirmation policy.

**Kind** is one of:

- **read**: changes nothing.
- **edit**: one undo step. Asks first only when **Ask before every edit** is on.
- **consequential**: always confirmed in the page. `render_frames` is the exception: the preview's
  consent covers it.

Some consequential tools need a builder capability and are not registered without it:
`replace_template` and `load_sample` need `replace`, `save_template` needs `save`, and `render_preview` and
`render_frames` need `preview-render` (WebAssembly). The builder offers `replace` and `save` everywhere.

**Confirm** says when the page asks you: `never`, `optional` (only when **Ask before every edit** is on) or
`always`.

**MCP** marks a name that `@leclap/mcp` also registers with the same meaning. Both surfaces compute the
same `revision` for the same JSON.

| Tool                  | Kind          | Confirm  | Input                                                                                               | MCP | What it does                                                                                                                  |
| --------------------- | ------------- | -------- | --------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------- |
| `get_template`        | read          | never    | `includeEditorState?`                                                                               |     | Returns the descriptor (uploads redacted), its `revision`, name, partials, selection, undo/redo state and what blocks saving. |
| `list_sections`       | read          | never    |                                                                                                     |     | Lists scenes in order: `position`, `pointer`, timing, transition, on-screen `texts` with pointers, and error count.           |
| `get_template_schema` | read          | never    | `pointer?`                                                                                          | yes | Returns the builder guide and the descriptor JSON Schema, sliced by pointer.                                                  |
| `get_motion_catalog`  | read          | never    | `query?`, `kind?`                                                                                   | yes | Returns the motion catalog, or ranked matches for a query.                                                                    |
| `list_samples`        | read          | never    | `category?`, `backend?`, `query?`                                                                   | yes | Lists the packaged samples. Each has an `openable` flag.                                                                      |
| `get_sample`          | read          | never    | `id`                                                                                                | yes | Returns one sample with its descriptor.                                                                                       |
| `validate_template`   | read          | never    | `template?`                                                                                         | yes | Validates without rendering, in the MCP shape. Adds motion advisories and `geometry` (measured with the bundled fonts).       |
| `get_timeline`        | read          | never    | `template?`, `format?`                                                                              | yes | Returns the timeline on whole-video seconds.                                                                                  |
| `select_section`      | read          | never    | `name?` or `position?`                                                                              |     | Selects a scene in the UI.                                                                                                    |
| `edit_template`       | edit          | optional | `expectedRevision`, `operations`, `note?`                                                           | yes | Applies an RFC 6902 JSON Patch to the descriptor.                                                                             |
| `add_section`         | edit          | optional | `expectedRevision`, `type`, `position?`, `section?`, `note?`                                        |     | Inserts a scene with the builder defaults, optionally merged with a fragment.                                                 |
| `remove_section`      | edit          | optional | `expectedRevision`, `name?` or `position?`, `note?`                                                 |     | Removes one scene.                                                                                                            |
| `move_section`        | edit          | optional | `expectedRevision`, `from`, `to`, `note?`                                                           |     | Moves one scene.                                                                                                              |
| `set_texts`           | edit          | optional | `expectedRevision`, `edits`, `note?`                                                                |     | Replaces on-screen copy, in batches.                                                                                          |
| `undo`                | edit          | never    |                                                                                                     |     | Reverts the agent's own last step, while it is still the current state. Never asks.                                           |
| `set_theme`           | edit          | optional | `expectedRevision`, `theme`, `note?`                                                                |     | Sets a built-in theme name or a theme object. `null` removes it.                                                              |
| `set_format`          | edit          | optional | `expectedRevision`, `orientation?`, `platform?`, `note?`                                            |     | Sets the orientation and the delivery platform.                                                                               |
| `set_music`           | edit          | optional | `expectedRevision`, `tracks?`, `allowUpload?`, `musicVolume?`, `sourceVolume?`, `ducking?`, `note?` |     | Sets library tracks (ids), user upload, volumes and ducking.                                                                  |
| `replace_template`    | consequential | always   | `template`, `name?`, `note?`                                                                        |     | Replaces the whole draft with a valid descriptor. Undo brings the previous draft back.                                        |
| `load_sample`         | consequential | always   | `id`, `theme?`, `note?`                                                                             |     | Opens an `openable` sample as a new draft.                                                                                    |
| `render_preview`      | consequential | always   | `note?`                                                                                             |     | Runs the WASM render with placeholder media, into the page's preview dialog.                                                  |
| `render_frames`       | consequential | never    | `at` (1–4 seconds)                                                                                  | yes | Experimental. Returns JPEG stills (≤ 200 KB each) of the agent's own open preview, as image content plus a text summary.      |
| `save_template`       | consequential | always   | `note?`                                                                                             |     | Saves to the template library on this device. The builder stays open.                                                         |

### How edits are applied

Every edit tool works the same way:

- **Revision.** The edit takes `expectedRevision`, the revision from `get_template` or `list_sections`. A
  stale value fails with `revision_conflict`.
- **All or nothing.** The edit applies completely or not at all, and it may not add validation errors.
- **Undo.** It lands as one history step, so Ctrl/Cmd+Z reverts it like your own edit.
- **Dropped fields.** Fields the builder model cannot hold come back in `dropped` with a
  `builder_dropped_field` warning. If the builder kept nothing of the edit, it fails with `no_effect`.
- **Effect sections.** `effect` sections are refused with `builder_unsupported_section`.
- **Light and effects.** `graphics[]` entries, including `type: "fx"` primitives and the `frame`, `corners` and
  `underline` stroke fields, pass through the builder unchanged. `get_motion_catalog` with `kind: "fx"` returns the
  primitives and their parameters. Effects show in `render_preview` and `render_frames`, not on the editing canvas.

### Errors

Errors are `isError` results with JSON text `{ code, message, hint?, errors? }`. The codes are:

| Code                          | Meaning                                               |
| ----------------------------- | ----------------------------------------------------- |
| `invalid_input`               | The arguments are invalid.                            |
| `too_large`                   | The input or output is too large.                     |
| `revision_conflict`           | `expectedRevision` is stale.                          |
| `invalid_template`            | The result would not validate.                        |
| `builder_unsupported_section` | The template uses a section the builder cannot hold.  |
| `no_effect`                   | The builder kept nothing of the edit.                 |
| `not_found`                   | The section, sample, track or preview does not exist. |
| `user_declined`               | You declined in the page.                             |
| `needs_user_attention`        | The tab is in the background.                         |
| `rate_limited`                | Too many calls; the result has `retryAfterMs`.        |
| `busy`                        | Another edit or action is running.                    |
| `render_failed`               | The preview render failed.                            |
| `save_blocked`                | The draft cannot be saved yet; the result says why.   |
| `aborted`                     | The agent cancelled the call.                         |
| `unavailable`                 | The tool is not available here.                       |

## Confirmation policy

- **Never unasked.** `replace_template`, `load_sample`, `render_preview` and `save_template` never run
  until you allow them in the page. The dialog says what will happen:
  - the new draft's name and scene count;
  - the sample's title;
  - the video length and the estimated render time;
  - the template name.

  The agent's note follows that description as plain text; it never replaces it.

- **Declining.** Cancel has the initial focus. Dismissing the dialog or ignoring it for 120 s declines,
  and the agent gets `user_declined`.
- **Checks come first.** A call that would fail anyway is refused before you are asked: an invalid
  template, an unknown or effect sample, a draft with errors, or a save blocker.
- **Preview limits.** `render_preview` runs one at a time, at most once every 30 s. Its dialog offers
  **Allow previews for the rest of this session**. An aborted call cancels the render on a best-effort
  basis.
- **Background tabs.** While the tab is hidden, these tools answer `needs_user_attention` instead of
  opening a dialog you cannot see.
- **Overlays.** Confirmations share the shell's single `agent` overlay with the drawer. They stack over
  the open drawer. Opening help, the presets or Generate with AI declines whatever is waiting.
- **Undo.** Replacing the draft or opening a sample is one history step: Undo brings the previous draft
  back.
- **Not exposed.** No tool films with real footage, uploads media or downloads exports. The agent asks
  you to click **Save & film**.

## Security

- **Same origin only.** Tools are never exposed to other origins: there is no `exposedTo`, and
  `Permissions-Policy: tools=(self)` is set.
- **No secrets.** The tool layer cannot reach the AI key store, IndexedDB media or the media service; a
  unit test walks its import graph to check this. Outputs keep uploads as opaque `media://` keys and
  replace upload labels with "user upload".
- **Media.** New media must be library ids, `media://` keys already in the draft, or same-origin URLs.
  `blob:`, `data:`, `javascript:` and `file:` URLs are refused.
- **Limits.**
  - Input: 512 KB at most.
  - Output: 200 KB of text at most. Each frame: 200 KB at most.
  - Edits: at most 100 patch operations and 50 text edits per call.
  - Rate: 60 reads and 20 edits per 10 s.
- **Agent text.** Text from the agent is NFC-normalized, and control and bidi-override characters are
  stripped. It is shown as plain text, never as HTML.
- **Untrusted content.** `get_template` and `list_sections` carry `untrustedContentHint`: a template
  shared by someone else is data, not instructions.

## How it is built

The feature lives in `apps/leclap-web` in three layers (see [Architecture](./architecture.md#web-builder-browser-agents-webmcp)):

- **Tool layer** (`src/application/usecases/webmcp/`): tool definitions, the guard (sizes, rates,
  sanitizing) and the registry. It changes the builder only through a `BuilderPort` and knows nothing of
  React or WebMCP.
- **Adapter** (`src/infrastructure/webmcp/`): detects `document.modelContext` (falling back to the
  deprecated `navigator.modelContext`, secure contexts only), registers each tool against one abort signal,
  and holds the settings store, the dev polyfill loader and the frame capture.
- **Builder** (`src/presentation/components/admin/agent/`): `useBuilderAgent` implements the port over the
  editor history, registers the tools once per on/off or capability change, and owns the confirmation
  queue, the Agent drawer and the confirmation dialog.

## Development and tests

- Start the dev server (`pnpm app:web`) and open `/studio/builder?webmcp=polyfill`. The drawer then says
  the tools come from the polyfill. With the testing shim, `navigator.modelContextTesting.listTools()` and
  `executeTool(name, json)` call the tools from the console.
- Unit tests sit next to the tool layer, the adapter and the drawer logic. `webmcpDocs.test.ts` checks
  that [/doc/webmcp](https://leclap.dev/doc/webmcp) lists exactly the registered tools with their kinds,
  confirmations and the names shared with `@leclap/mcp`. `tests/webmcp-bundle.test.ts` checks that a
  production build keeps WebMCP out of the entry and leaves the polyfill out.
- `e2e/webmcp-builder.spec.ts` drives the builder through the polyfill's testing shim. It needs a dev
  server (see the [web app README](../apps/leclap-web/README.md#end-to-end-tests)); `E2E_WASM=1` adds the
  `render_preview` and `render_frames` cases, and `E2E_CHROMIUM_PATH` points at a preinstalled Chromium.

## Troubleshooting

| Symptom                                        | Check                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| No **Agent** button                            | The browser has no `document.modelContext`: turn on the flag or the trial, use HTTPS or `localhost`, and check the build has no `VITE_WEBMCP=0`. |
| The agent sees no tools                        | **Let browser agents use this builder** is off, or you left the builder. Tools exist only on the builder routes.                                 |
| "Some tools could not be registered"           | The browser refused those names (a duplicate, or a frame the `Permissions-Policy` does not allow). The other tools still work.                   |
| `needs_user_attention`                         | The tab is in the background. Bring it to the front and ask the agent to retry.                                                                  |
| `revision_conflict`                            | The draft changed since the agent read it, often your own edit. The agent reads `get_template` again and retries.                                |
| `render_preview` or `render_frames` is missing | The browser has no WebAssembly, so the builder does not offer `preview-render`.                                                                  |
| `render_frames` returns `not_found`            | No preview of the agent's own is open. It needs an allowed `render_preview` first.                                                               |

## Which agent path

| Path                                              | Who runs the model                   | What it does                                                                     |
| ------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| [Generate with AI](./ai-template-generation.md)   | The page, with your own API key      | One-shot: drafts a whole template from a brief.                                  |
| WebMCP (this page)                                | Your browser's agent and its billing | Incremental: inspects, validates and patches the open draft, each step undoable. |
| [`@leclap/mcp`](../packages/leclap-mcp/README.md) | A desktop or CLI agent               | Local server: authors templates and renders final videos from your own media.    |
