// The MCP reference data behind /doc/mcp. Mirrors packages/leclap-mcp (src/server.ts, src/config.ts
// and the per-tool input schemas) — tool names, arguments, config keys and defaults must match the
// server, so change them together.

export interface McpToolDoc {
  name: string;
  /** The tool's input arguments, in the tools/list order. `?` marks an optional one. */
  args: string;
  purpose: string;
  when: string;
  /** Registered only behind `--allow-remotion`; rendered with an opt-in marker. */
  optIn?: boolean;
}

export interface McpConfigDoc {
  label: string;
  flag: string;
  env: string;
  /** The value the server falls back to with neither flag nor env set. */
  fallback: string;
  detail: string;
}

export interface McpDoc {
  id: 'mcp';
  title: string;
  intro: string;
  flow: string[];
  tools: McpToolDoc[];
  config: McpConfigDoc[];
  sampleConfig: string;
  projectConfig: string;
  agenticReview: {
    intro: string;
    steps: string[];
    uploadBoundary: string;
  };
}

export const mcpDoc: McpDoc = {
  id: 'mcp',
  title: 'MCP for agents',
  intro:
    'The LeClap MCP server exposes this same descriptor engine to local AI agents. The agent authors a JSON descriptor from the schema, the server validates it, and compose_video renders a deterministic MP4 through the FFmpeg pipeline. The packaged catalog includes 51 samples with creative direction and input requirements. Registered JSON effects use a configured trusted Node/Remotion backend; render_remotion_clip also accepts your own Remotion composition.',
  flow: ['get_samples', 'get_template_schema', 'get_motion_catalog', 'validate_template', 'compose_video'],
  agenticReview: {
    intro:
      'For a pull or merge request, the development agent can turn a real walkthrough into a short evidence video before handing the change to a reviewer.',
    steps: [
      'collect implementation evidence',
      'author the review template',
      'validate_template',
      'compose_video',
      'attach the returned outputPath to the PR or MR',
    ],
    uploadBoundary:
      'The LeClap MCP server renders and returns the local artifact. It does not upload to GitHub or GitLab; the surrounding agent workflow must perform that explicit step.',
  },
  tools: [
    {
      name: 'get_samples',
      args: 'id?, category?, backend?, query?',
      purpose:
        'Without id, lists packaged samples with creative direction, required inputs and backend setup (filtered by category, backend or query). With id, returns that sample with its descriptor, embedded partials and input requirements.',
      when: 'Available without FFmpeg or Remotion; media and preview videos are not downloaded. Customize copy, supply required clips/assets and inspect setup before validating.',
    },
    {
      name: 'get_template_schema',
      args: 'no arguments',
      purpose: 'Returns the authoritative JSON Schema for the template descriptor plus a short authoring guide.',
      when: 'Use before authoring or modifying descriptor JSON.',
    },
    {
      name: 'get_motion_catalog',
      args: 'query?, kind?',
      purpose:
        'Returns the motion catalog: kinetic presets, camera moves, graphics, designed transitions, the easing and time-reference grammar, motion tokens, themes, delivery platforms, genre doctrine and validated scene blueprints. With a query, returns ranked matches instead (optionally one kind).',
      when: 'Use before authoring animated copy, camera moves, graphics or designed transitions. An empty search carries a gap, logged under the output dir for maintainers: compose the need from the closest primitives.',
    },
    {
      name: 'validate_template',
      args: 'template, render?, include?, fields?, format?',
      purpose:
        'Dry-runs validation of an inline descriptor — no render unless render: true, which renders the text-bearing sections and measures contrast from real pixels (seconds). Returns valid, revision, capabilities, sectionCount, orientation, requiredClips and formFields, plus an optional geometry array listing text that would run off the frame or out of title-safe, collide with other text, sit under a band, be too small, lack contrast, or sit over footage with no box, outline or shadow. include: ["resolved"] adds the descriptor compose_video starts from for these fields and format (partials expanded, global.fields typed); include: ["timeline"] adds sections on whole-video seconds, every motion event, the beat grid and cues.',
      when: 'Use repeatedly to iterate on the descriptor before a slower render. The geometry findings are advisory — valid stays true — and the field is absent when there is nothing to fix. Ask for the timeline to pick render_frames moments and align hits with beats; ask for resolved to check where a field lands (a refused value is an error naming the field).',
    },
    {
      name: 'get_effect_schema',
      args: 'id?, version?, list?',
      purpose:
        'Lists registered effect identities or describes strict props, local asset slots, output and contract digest.',
      when: 'Use list: true for discovery, or exact id/version for a contract. The zero-argument call describes the builtin title.',
      optIn: true,
    },
    {
      name: 'render_preview',
      args: 'template, section, frames? or frameRange?, expectedRevision?, userVideoPaths?',
      purpose: 'Renders selected effect-local frames or a short inclusive range through the configured trusted entry.',
      when: 'Use expanded section names, including partial prefixes. Provide 1..10 distinct frames in 0..299, or an inclusive range of 1..90 frames.',
      optIn: true,
    },
    {
      name: 'edit_template',
      args: 'template, expectedRevision, operations?, effectProps?',
      purpose:
        'Applies a JSON Patch (RFC 6902) and registered effect-prop edits by expanded section name atomically; the result must validate. Returns updated JSON, revision, changedPaths and, for effect props, changedSections.',
      when: "Use for any descriptor change with the revision validate_template returned. effectProps reach effects inside partials; a registry partial edit materializes only that instance. The builder's browser tools (WebMCP) expose the same name and JSON Patch contract.",
    },
    {
      name: 'compose_video',
      args: 'template, fields?, userVideoPaths?, locale?, outputBaseName?, expectedRevision?',
      purpose:
        'Validates then renders an inline descriptor. Returns outputPath, durationSeconds, sizeBytes, videoCodec, audioCodec and renderId, plus a resource_link to the mp4. Effect templates also report effectProvenance and effectCache.',
      when: 'Use after validation succeeds and every project_video section has a clip in userVideoPaths.',
    },
    {
      name: 'render_frames',
      args: 'template, at?, atTransitions?, perSection?, sheet?, safe?, zoom?, variants?, looks?, fields?, userVideoPaths?, locale?, format?',
      purpose:
        'Renders a native template (through the section cache) and returns still frames as PNG image content plus their paths: chosen moments, both sides of every cut, each settled section; contact sheets, platform safe-zone shading, crops, variant and LOOK comparison grids.',
      when: 'Use after validate_template to look at the result and check safe zones before the final compose_video.',
    },
    {
      name: 'probe_media',
      args: 'path',
      purpose: 'Inspects a local media file and reports codecs, duration, sample rate, and size.',
      when: 'Use to check a user-supplied clip before composing. The path must resolve inside the media dir.',
    },
    {
      name: 'extract_style',
      args: 'path, seed?',
      purpose:
        'Derives a global.theme object and a style guide from a reference image or clip: palette roles with area shares and WCAG contrast, grain texture, and for clips the average shot length, cuts per minute, motion energy and a suggested genre.',
      when: 'Use to match a reference look. Palette and pacing only: subjects, logos and text are never copied. The path must resolve inside the media dir.',
    },
    {
      name: 'analyze_music',
      args: 'path, beatsPerBar?, includeTimes?',
      purpose:
        'Measures a music file: BPM, beat 1 offset, beats per bar, confidence, usable, and build/drop/end cues, plus globalBeats to paste into global.beats.',
      when: 'Use before timing cuts and hits to the music ("beat:n", "bar:n", "cue:drop"). When usable is false (calm or ambient music), pace by phrases instead.',
    },
    {
      name: 'analyze_sound',
      args: 'sound, seed?, music?',
      purpose:
        'Renders a sound effect with the engine synth (composed layers, or a library preset with pitch/length/brightness/room) and measures it: length, peak and RMS dBFS, raw pre-normalisation peak, spectral centroid, energy above 8 kHz and under 250 Hz, attack time, the sound advisories it raises, plus a spectrogram and a waveform PNG.',
      when: 'Use while composing an sfx sound: iterate until the numbers match the intent (a warm pop: centroid under 2 kHz, attack under 10 ms), then place it in the template.',
    },
    {
      name: 'transcribe_media',
      args: 'path, language?, model?',
      purpose:
        'Transcribes the speech of a local audio or video file with whisper.cpp on the host — the audio never leaves the machine — into word timings (seconds into the file), an SRT, the language and the mean confidence.',
      when: 'Use for captions: transcribe once, pin the words into subtitles.words (or put subtitles.transcribe on the section and let compose_video pin them), then have the user review them. Needs whisper.cpp and a model the operator downloaded once with leclap transcribe --download-model.',
    },
    {
      name: 'get_capabilities',
      args: 'no arguments',
      purpose:
        'Reports what the local FFmpeg really renders — drawtext with a bundled font, text shaping, libass, zscale/tonemap, lut3d, xfade, gblur, alphamerge, loudnorm, ebur128, libx264 — each usable yes/no/unknown with a fix, plus fonts and encoders. Same JSON as leclap diagnose --json.',
      when: 'Use when a render fails on a filter or before relying on text, LUT looks or designed transitions on an unknown machine; validate_template flags the same gaps as featureWarnings.',
    },
    {
      name: 'open_in_builder',
      args: 'template, baseUrl?',
      purpose:
        'Returns a link that opens the template in the web builder for a person to edit: url, length, mediaToRebind (local paths and uploads the browser cannot read, which open as empty slots) and warnings. The template rides compressed in the URL fragment, which browsers never send to a server, so nothing is uploaded.',
      when: 'Use to hand a validated template to a person. baseUrl targets a locale (https://leclap.dev/fr) or a local dev server.',
    },
    {
      name: 'render_remotion_clip',
      args: 'compositionId, entry?, serveUrl?, inputProps?, outputName?',
      purpose:
        'Renders a composition from your own Remotion project to an MP4 clip — motion graphics FFmpeg cannot express.',
      when: 'For an animated intro: render the clip, then feed it to compose_video as a project_video via userVideoPaths.',
      optIn: true,
    },
  ],
  config: [
    {
      label: 'Output dir',
      flag: '--output-dir',
      env: 'LECLAP_MCP_OUTPUT_DIR',
      fallback: '~/.leclap/renders',
      detail: 'Where renders land — one folder per renderId.',
    },
    {
      label: 'Media allowlist',
      flag: '--media-dir',
      env: 'LECLAP_MCP_MEDIA_DIR',
      fallback: '~/.leclap/media',
      detail:
        'The containment root for local input files. The default is deliberately narrow: pointing it at your home directory would let any tool call read the whole of $HOME.',
    },
    {
      label: 'Remotion opt-in',
      flag: '--allow-remotion',
      env: 'LECLAP_MCP_ALLOW_REMOTION',
      fallback: 'off',
      detail:
        'Registers get_effect_schema, render_preview and render_remotion_clip. Trusted local JavaScript runs in Chromium; JSON cannot select executable source for registered effects.',
    },
    {
      label: 'Remotion entry',
      flag: '--remotion-entry',
      env: 'LECLAP_MCP_REMOTION_ENTRY',
      fallback: 'none',
      detail:
        'Trusted module calling registerRoot. Required for registered JSON effects; also the default entry for render_remotion_clip.',
    },
    {
      label: 'Render timeout',
      flag: '--render-timeout-ms',
      env: 'LECLAP_MCP_RENDER_TIMEOUT_MS',
      fallback: '600000 (10 minutes)',
      detail:
        'Separate deadline for queue wait, asset preflight and worker setup/render; final FFmpeg rendering also has its own deadline. This is not a whole-request time budget.',
    },
    {
      label: 'Chrome executable',
      flag: '--remotion-browser',
      env: 'LECLAP_MCP_REMOTION_BROWSER',
      fallback: 'none; Remotion manages its browser',
      detail: 'Absolute path to a compatible installed Chrome executable for registered effects.',
    },
    {
      label: 'Operator effect catalog',
      flag: '--effect-catalog',
      env: 'LECLAP_MCP_EFFECT_CATALOG',
      fallback: 'none; builtin contracts only',
      detail:
        'Strict JSON contracts loaded once at startup. Register their compositions in the trusted entry and restart after catalog edits.',
    },
    {
      label: 'Effect cache bytes',
      flag: '--effect-cache-max-bytes',
      env: 'LECLAP_MCP_EFFECT_CACHE_MAX_BYTES',
      fallback: '536870912 (512 MiB)',
      detail:
        'Artifact cache under <media-dir>/.leclap-effects/cache-v1, with at most 256 entries. Zero disables lookup/publication; invalid values use the default.',
    },
    {
      label: 'Catalog gap log',
      flag: '--catalog-gap-log',
      env: 'LECLAP_MCP_CATALOG_GAP_LOG',
      fallback: 'catalog-gaps.jsonl',
      detail:
        'JSONL file get_motion_catalog appends unmatched queries to, relative to the output dir. Paths that resolve outside the output dir are refused.',
    },
  ],
  // Mirrors the one-click editor deep-links in docMarkdown.ts, which install via npx. Env values are
  // absolute because they are not tilde-expanded.
  sampleConfig: JSON.stringify(
    {
      mcpServers: {
        leclap: {
          command: 'npx',
          args: ['-y', '@leclap/mcp'],
          env: {
            LECLAP_MCP_OUTPUT_DIR: '/abs/path/to/Movies/leclap-renders',
            LECLAP_MCP_MEDIA_DIR: '/abs/path/to/Movies',
          },
        },
      },
    },
    null,
    2
  ),
  // What `leclap init --mcp --remotion` writes as the project's .mcp.json: the media dir is scoped to
  // the project, and the Remotion opt-in is set because the scaffold ships a remotion/ entry.
  projectConfig: JSON.stringify(
    {
      mcpServers: {
        leclap: {
          command: 'npx',
          args: ['@leclap/mcp'],
          env: {
            LECLAP_MCP_MEDIA_DIR: '/abs/path/to/my-video',
            LECLAP_MCP_OUTPUT_DIR: '/abs/path/to/my-video/build',
            LECLAP_MCP_REMOTION_ENTRY: '/abs/path/to/my-video/remotion/index.ts',
            LECLAP_MCP_ALLOW_REMOTION: '1',
          },
        },
      },
    },
    null,
    2
  ),
};
