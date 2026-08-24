// The agent guidance `init` writes into a generated project: an AGENTS.md pointer and one skill.
//
// Deliberately NOT a field reference. The descriptor schema is already documented in two places we
// control (the MCP's get_template_schema guide and leclap.dev/doc) — a third copy would ship to user
// machines where we can never update it, so it drifts worst of all. This file points at the live
// authority and spends its words on what a schema cannot express: the render loop, the cost model,
// and the traps that silently send an agent the wrong way.

export interface SkillOptions {
  /** The project has a `.mcp.json`, so the agent can reach the engine's own tools. */
  mcp?: boolean;
  /** The project has a `remotion/` starter whose `Intro` composition feeds the intro section. */
  remotion?: boolean;
}

const SCHEMA_URL = 'https://leclap.dev/doc/schema';
const DOC_URL = 'https://leclap.dev/doc';

// Where the descriptor's authoritative shape comes from. With the MCP wired the agent can fetch it
// in-session; without it, the docs site is the only live copy.
function authority(mcp: boolean): string {
  if (mcp) {
    return `Call \`get_template_schema\` — it returns the JSON Schema plus an authoring guide, and it is
always current with the installed engine. The reference is also published at ${SCHEMA_URL}.`;
  }

  return `Read ${SCHEMA_URL} — it is the published field reference. \`leclap validate\` is the fast
local check: it reports the exact failing path, so an unknown field is one command away from a
precise answer rather than a guess.`;
}

function mcpSection(remotion: boolean): string {
  const intro = remotion
    ? `

For an animated intro that filters cannot express, render the bundled Remotion composition first and
hand the clip back:

\`\`\`
render_remotion_clip { compositionId: "Intro" }   → an mp4 path
compose_video { template, userVideoPaths: { intro: "<that path>" } }
\`\`\`

The \`intro\` section in \`template.json\` is the slot it fills. Edit \`remotion/Intro.tsx\` to change what
it looks like.`
    : '';

  return `

## Rendering through the MCP

This project ships a \`.mcp.json\`, so the engine is callable directly:

\`\`\`
get_template_schema  → author the descriptor inline
validate_template    → instant, no render; iterate here until it passes
compose_video        → renders, returns outputPath
\`\`\`

Iterate on \`validate_template\`, not \`compose_video\` — validation is instant and a render is not.${intro}`;
}

export function starterSkill(projectName: string, opts: SkillOptions = {}): string {
  const mcp = Boolean(opts.mcp);

  return `---
name: authoring-leclap-videos
description: Use when editing template.json in ${projectName}, adding or changing sections, transitions, looks, colour grading, motion or audio, or when a render fails or looks wrong.
---

# Authoring this LeClap video

\`template.json\` is a **descriptor**: a \`global\` object of project-wide defaults plus an ordered
\`sections\` array. Each section becomes one clip; they are composed in order. The engine compiles it
to an mp4 with FFmpeg — same input, same output, every time.

| | |
| --- | --- |
| Edit | \`template.json\` |
| Check | \`leclap validate template.json\` — instant, no FFmpeg |
| Render | \`leclap render template.json\` |
| Media in | \`assets/\` |
| Video out | \`build/\` |
| Field reference | ${SCHEMA_URL} |

## The loop

\`\`\`bash
leclap validate template.json   # schema check, no FFmpeg, instant
leclap render template.json     # compile to build/
\`\`\`

Run \`validate\` after every edit. It never invokes FFmpeg, so it costs nothing and tells you exactly
which path is wrong. Both paths above are relative to the directory you run the command in.

Not for \`remotion/\` — that is a React project with its own rules.

## Where the field reference lives

${authority(mcp)}

## Reach for the sugar tier first

Above the raw FFmpeg layer sits a structured tier — \`transition\`, \`look\`, \`grade\`, \`motion\`, and
\`audio\` — that compiles down to safe filters for you. Prefer it. \`filters[]\` is the raw escape
hatch: it takes FFmpeg-native keys, and a mistake there surfaces as a filtergraph error rather than a
validation one.

Reference for the tier: ${DOC_URL}

## What a render costs

A template whose transitions are all \`cut\` is concatenated by **stream copy** — no re-encode, fast
even in a browser or on a phone. Any other transition (\`fade\`, \`wipeleft\`, …) triggers a single
**re-encode of the whole timeline**. That is the expensive part, so keep transition durations short
and use cuts where the edit allows.

## Traps

- **\`options.speed\` is a PTS multiplier, not a rate.** \`2\` gives you **slow motion** — half speed —
  and \`0.5\` makes the clip twice as fast. The name reads backwards from what it does.
- **Every duration is in seconds** — \`options.duration\`, \`transition.duration\`, audio fades. Never
  frames, never milliseconds.
- **A \`project_video\` section needs a clip supplied at render time.** It has no media of its own; a
  render without one fails.

## Passing values in

Text in the descriptor can hold \`{{ variables }}\`, resolved when it compiles. Fill them, and any
\`project_video\` clip, from the command line:

\`\`\`bash
leclap render template.json --field title="Summer" --video intro=assets/clip.mp4
\`\`\`

Both flags repeat. \`--orientation landscape|portrait|square\` re-cuts the same descriptor for another
aspect ratio without editing it.${mcp ? mcpSection(Boolean(opts.remotion)) : ''}
`;
}

// A thin pointer, not a second copy of the guidance — AGENTS.md is read by most agent clients, and
// its only job here is to route them to the skill.
export function agentsMd(projectName: string): string {
  return `# ${projectName}

A LeClap video project: \`template.json\` is the descriptor, \`assets/\` holds the media, renders land
in \`build/\`.

Before editing the template or debugging a render, read
[\`.agents/skills/authoring-leclap-videos/SKILL.md\`](./.agents/skills/authoring-leclap-videos/SKILL.md). It covers the
validate/render loop, which authoring layer to use, and the traps that do not surface as errors.
`;
}
