// The agent guidance `init` writes into a generated project: an AGENTS.md pointer and one skill.
//
// Deliberately NOT a field reference. The descriptor schema is already documented in two places we
// control (the MCP's get_template_schema guide and leclap.dev) — a third copy would ship to user
// machines where we can never update it, so it drifts worst of all. This file points at the live
// authority and spends its words on what a schema cannot express: the render loop, the cost model,
// and the traps that silently send an agent the wrong way.

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface SkillOptions {
  /** The project has a `.mcp.json`, so the agent can reach the engine's own tools. */
  mcp?: boolean;
  /** The project has a `remotion/` starter whose `Intro` composition feeds the intro section. */
  remotion?: boolean;
  /** Renders the run commands for the package manager the project was scaffolded with. */
  packageManager?: PackageManagerName;
}

// `leclap` is a devDependency, never a global install, so a bare `leclap render` is `command not
// found` in a scaffolded project. Every command goes through the package manager's script runner,
// which is what puts node_modules/.bin on PATH.
const RUN_SCRIPT: Record<PackageManagerName, (script: string) => string> = {
  npm: (script) => `npm run ${script}`,
  pnpm: (script) => `pnpm ${script}`,
  yarn: (script) => `yarn ${script}`,
  bun: (script) => `bun run ${script}`,
};

// llms.txt, not /doc/schema: the docs site is a client-rendered SPA whose body only exists after
// React hydrates (scripts/seo-prerender.ts pre-bakes <head> alone), so an agent that fetches a /doc
// route receives an empty shell. llms.txt is served as text and indexes the rest.
const LLMS_URL = 'https://leclap.dev/llms.txt';
const DOC_URL = 'https://leclap.dev/doc';

// Where the descriptor's authoritative shape comes from. With the MCP wired the agent can fetch it
// in-session; without it, llms.txt is the machine-readable entry point.
function authority(mcp: boolean, validate: string): string {
  if (mcp) {
    return `Call \`get_template_schema\` — it returns the JSON Schema plus an authoring guide, and it is
always current with the installed engine.`;
  }

  return `Fetch ${LLMS_URL} — it indexes the field reference for machine retrieval. (The \`/doc\` pages
render client-side, so fetching one directly returns an empty shell.) \`${validate}\` is the fast local
check: it reports the exact failing path, so an unknown field is one command away from a precise
answer rather than a guess.`;
}

// The Remotion hand-off, gated on the Remotion scaffold itself. Only reachable through the MCP, so
// it also states that dependency rather than assuming the reader has it.
function remotionSection(): string {
  return `

## The animated intro

\`remotion/\` is a separate React project — its own rules, not this skill's. The engine cannot express
spring physics or kinetic typography, so that intro is rendered there and composited here.

Through the MCP:

\`\`\`
render_remotion_clip { compositionId: "Intro" }   → an mp4 path
compose_video { template, userVideoPaths: { intro: "<that path>" } }
\`\`\`

The \`intro\` section in \`template.json\` is the \`project_video\` slot it fills — it carries no media of
its own, so a render that supplies no clip for it fails. Edit \`remotion/Intro.tsx\` to change how it
looks. From the command line the equivalent is \`--video intro=<path>\`.`;
}

function mcpSection(): string {
  return `

## Rendering through the MCP

This project ships a \`.mcp.json\`, so the engine is callable directly:

\`\`\`
get_template_schema  → author the descriptor inline
validate_template    → instant, no render; iterate here until it passes
compose_video        → renders, returns outputPath
\`\`\`

Iterate on \`validate_template\`, not \`compose_video\` — validation is instant and a render is not.`;
}

export function starterSkill(projectName: string, opts: SkillOptions = {}): string {
  const mcp = Boolean(opts.mcp);
  const remotion = Boolean(opts.remotion);
  const run = RUN_SCRIPT[opts.packageManager ?? 'npm'];
  const validate = run('validate');
  const render = run('render');

  // A directory name may legally contain `:` or `#`, either of which breaks a plain YAML scalar and
  // silently makes the whole frontmatter unparseable. YAML double-quoted scalars are JSON-compatible.
  const description = JSON.stringify(
    `Use when editing template.json in ${projectName}, adding or changing sections, transitions, looks, colour grading, motion or audio, or when a render fails or looks wrong.`
  );

  return `---
name: authoring-leclap-videos
description: ${description}
---

# Authoring this LeClap video

\`template.json\` is a **descriptor**: a \`global\` object of project-wide defaults plus an ordered
\`sections\` array. Each section becomes one clip; they are composed in order. The engine compiles it
to an mp4 with FFmpeg — same input, same output, every time.

| | |
| --- | --- |
| Edit | \`template.json\` |
| Check | \`${validate}\` — instant, no FFmpeg |
| Render | \`${render}\` |
| Media in | \`assets/\` |
| Video out | \`build/\` |
| Field reference | ${LLMS_URL} |

## The loop

\`\`\`bash
${validate}   # schema check, no FFmpeg, instant
${render}     # compile to build/
\`\`\`

Run the check after every edit. It never invokes FFmpeg, so it costs nothing and tells you exactly
which path is wrong. Both directories above are relative to the project root.

## Where the field reference lives

${authority(mcp, validate)}

## Reach for the sugar tier first

Above the raw FFmpeg layer sits a structured tier — \`transition\`, \`look\`, \`grade\`, \`motion\`,
\`caption\` and \`audio\` — that compiles down to safe filters for you. Prefer it. \`filters[]\` is the
raw escape hatch: it takes FFmpeg-native keys, and a mistake there surfaces as a filtergraph error
rather than a validation one.

Reference for the tier: ${DOC_URL}

## What a render costs

A template whose transitions are all \`cut\` is concatenated by **stream copy** — no re-encode, fast
even in a browser or on a phone. Any other transition (\`fade\`, \`wipeleft\`, …) triggers a single
**re-encode of the whole timeline**. That is the expensive part, so keep transition durations short
and use cuts where the edit allows.

## Traps

- **\`options.speed\` is a PTS multiplier, not a rate.** \`2\` gives you **slow motion** — half speed —
  and \`0.5\` makes the clip twice as fast. The name reads backwards from what it does.
- **Durations are in seconds, with one exception.** \`options.duration\`, \`transition.duration\` and
  audio fades are all seconds. \`global.audio.ducking\`'s \`attack\` and \`release\` are **milliseconds**
  (defaults 20 and 400) — write \`attack: 20\`, not \`0.02\`. Both are unbounded, so the wrong unit
  validates and renders, and the only symptom is a pumping music bed.
- **Check the unit before you write a number.** When the sugar tier gains a field, the schema
  description states its unit; trust that over any rule of thumb.

## Passing values in

Text in the descriptor can hold \`{{ variables }}\`, resolved when it compiles. Fill them from the
command line:

\`\`\`bash
${render} -- --field title="Summer"
\`\`\`

\`--field\` repeats. \`--orientation landscape|portrait|square\` re-cuts the same descriptor for another
aspect ratio without editing it.${remotion ? remotionSection() : ''}${mcp ? mcpSection() : ''}
`;
}

// A thin pointer, not a second copy of the guidance — AGENTS.md is read by most agent clients, and
// its only job here is to route them to the skill.
export function agentsMd(projectName: string, opts: SkillOptions = {}): string {
  const run = RUN_SCRIPT[opts.packageManager ?? 'npm'];

  return `# ${projectName}

A LeClap video project: \`template.json\` is the descriptor, \`assets/\` holds the media, renders land
in \`build/\`. Install once, then \`${run('render')}\`.

Before editing the template or debugging a render, read
[\`.agents/skills/authoring-leclap-videos/SKILL.md\`](./.agents/skills/authoring-leclap-videos/SKILL.md).
It covers the check/render loop, which authoring layer to use, and the traps that do not surface as
errors.
`;
}
