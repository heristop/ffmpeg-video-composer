# LeClap, Remotion, editly and fluent-ffmpeg

Four ways to get a video out of JavaScript. They overlap less than their search results suggest. This page
says what each one is, where it runs, and when you should pick it, LeClap included. Every claim about the
other three comes from their own README or docs, linked under [Sources](#sources) and checked on
13 October 2026. A cell reads "—" when their docs don't say. Something wrong or out of date?
[Open an issue](https://github.com/heristop/leclap/issues) and the table gets fixed.

## At a glance

|                         | **LeClap**                                                       | Remotion                                                                                                                         | editly                                                       | fluent-ffmpeg                                                                           |
| ----------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| What it is              | A JSON template compiled to FFmpeg commands                      | A framework for making videos with React                                                                                         | Declarative video editing, as a CLI and a Node API           | A chainable Node API that builds `ffmpeg` command lines                                 |
| You write               | A Zod-validated JSON template                                    | React components (TypeScript)                                                                                                    | A JSON5 edit spec, CLI arguments or a JS object              | Chained JS method calls                                                                 |
| Node                    | Yes: system FFmpeg, or `ffmpeg-static`                           | Yes: Node APIs, plus Lambda and Vercel                                                                                           | Yes, with `ffmpeg` and `ffprobe` on PATH, plus `gl` / canvas | Yes, with `ffmpeg` and `ffprobe` installed                                              |
| Browser                 | Yes: FFmpeg compiled to WebAssembly                              | Yes: WebCodecs, stable since 4.0.491                                                                                             | —                                                            | —                                                                                       |
| React Native, on-device | Yes: FFmpeg linked into the app (iOS, Android)                   | —                                                                                                                                | —                                                            | —                                                                                       |
| Same input, same output | Per platform: the encoder differs between targets                | When animations derive only from `useCurrentFrame()` and avoid randomness                                                        | —                                                            | —                                                                                       |
| Checking a render       | `leclap verify --rerender` re-renders and compares digests       | —                                                                                                                                | —                                                            | —                                                                                       |
| Agent tooling           | `@leclap/mcp` (schema, validate, compose); WebMCP in the builder | A system prompt that teaches an LLM to write Remotion code                                                                       | —                                                            | —                                                                                       |
| Licence                 | MIT (the name is a trademark)                                    | Remotion License: free for individuals, for-profit companies up to 3 employees and non-profits; a paid company licence otherwise | MIT                                                          | MIT                                                                                     |
| Status                  | Active                                                           | Active                                                                                                                           | Maintained by one person, per its README                     | Archived on 22 May 2025; its README says it no longer works properly with recent ffmpeg |

## What each one is

**LeClap** ([`ffmpeg-video-composer`](../packages/ffmpeg-video-composer)) reads one JSON template (a `global`
block and an ordered list of sections, each with its inputs, filters and transition) and compiles it into
FFmpeg commands. The same template renders on Node, in the browser through WebAssembly, and inside a React
Native app through an FFmpeg engine linked into the app. There is no render server to run and no upload step.

**Remotion** turns React components into video: the composition is a function from a frame number to an
image. It renders on Node, on AWS Lambda or Vercel, and, since 4.0.491, in the browser through WebCodecs.

**editly** describes an edit (clips, images, titles, transitions, audio) as a JSON5 spec, then renders it
with Node, ffmpeg and headless GL. It ships as a CLI and as a JS function.

**fluent-ffmpeg** wraps the `ffmpeg` command line in a chainable Node API. It does not compose anything; it
builds and runs the command you describe.

## Where the others win

- **Remotion, if your composition is really a component tree.** Hooks, springs, interpolation, component
  reuse and a live preview: a JSON template is deliberately too narrow to say all of that. If you already
  think in React, keep thinking in React.
- **Remotion, if you render on servers, at scale.** It documents distributed rendering on Lambda. LeClap has no
  render farm and is not building one.
- **Remotion, for its ecosystem.** Years of releases, an embeddable player, templates, and a community that has
  already answered questions nobody has asked LeClap yet.
- **editly, for a quick slideshow from the terminal.** `editly title:'My video' clip1.mov clip2.mov` is hard
  to beat for a one-off, and its GL transitions come from the gl-transitions collection.
- **fluent-ffmpeg, if a codebase already depends on it** and still works with the ffmpeg it runs. For new code,
  its own README points away from it.

## Where LeClap wins

- **The video is composed inside a native app.** Camera, effects, music, transitions and the render all run in
  the iOS or Android app, with FFmpeg linked in and no browser engine in the path.
- **The media must stay on the device.** There is no upload step to turn off, because there is no upload.
- **A program or an agent writes the composition.** A validated JSON document is easier to generate, diff,
  store and review than a component you have to compile first. `@leclap/mcp` gives an agent the schema, a
  validator and a renderer; no model sits in the output path.
- **You want the render checked in CI.** A render can record a manifest; `leclap verify --rerender` renders the
  recorded template again and compares every digest.

## The caveats, ours first

- LeClap's determinism holds per platform, not across platforms. Node and the browser encode with libx264,
  Android with `libopenh264`, iOS with `h264_videotoolbox`. The on-device build is LGPL, so its filter set is
  narrower: `boxblur` is dropped and `eq` is rewritten to `lutyuv`. Same template, same cuts and timings,
  different pixels.
- On Node, LeClap uses the first FFmpeg it finds on PATH before falling back to `ffmpeg-static`. Some FFmpeg
  builds (Homebrew's current one among them) ship without `drawtext`, and text sections then render without
  their text. `leclap diagnose` reports which features your FFmpeg is missing.
- Remotion's browser renderer emulates layout and styles onto a canvas rather than taking a screenshot, so its
  docs list where client-side output differs from the browser's own rendering.

## Sources

- Remotion README: <https://github.com/remotion-dev/remotion>
- Remotion licence: <https://github.com/remotion-dev/remotion/blob/main/LICENSE.md>
- Remotion client-side rendering: <https://www.remotion.dev/docs/client-side-rendering>
- Remotion client-side rendering limitations: <https://www.remotion.dev/docs/client-side-rendering/limitations>
- Remotion on determinism and randomness: <https://www.remotion.dev/docs/flickering>
- Remotion system prompt for LLMs: <https://www.remotion.dev/docs/ai/system-prompt>
- Remotion on Lambda: <https://www.remotion.dev/docs/lambda>
- editly README: <https://github.com/mifi/editly>
- fluent-ffmpeg README and archive notice: <https://github.com/fluent-ffmpeg/node-fluent-ffmpeg>
- The longer LeClap vs Remotion page: <https://leclap.dev/compare/remotion>
