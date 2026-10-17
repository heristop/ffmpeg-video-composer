import { describe, it, expect } from 'vitest';
import { agentsMd, starterSkill } from '../src/commands/starter-skill';

// The scaffolded skill is the only LeClap guidance an agent gets inside a generated project — there
// is no monorepo, no docs/ and (without --mcp) no get_template_schema. These tests pin the two
// things that make it useful: it points at a live authority rather than restating the schema, and
// it carries the traps a schema cannot express.

describe('starterSkill', () => {
  const skill = starterSkill('demo');

  it('opens with the frontmatter a skill loader reads', () => {
    expect(skill.startsWith('---\n')).toBe(true);
    expect(skill).toContain('name: authoring-leclap-videos');
    expect(skill).toMatch(/^description: "Use when .+"$/m);
  });

  // Agents scan before they read. The checklist facts — which command, which directory — belong in a
  // table at the top, not buried in prose three sections down.
  it('opens with a scannable quick-reference table', () => {
    // Everything above the first `##` — the table has to be reachable without reading a section.
    const preamble = skill.slice(0, skill.indexOf('\n## '));
    expect(preamble).toMatch(/^\| --- \| --- \|$/m);
    expect(preamble).toMatch(/^\| Render \|/m);
  });

  it('names the check → render loop', () => {
    expect(skill).toContain('npm run validate');
    expect(skill).toContain('npm run render');
  });

  it('sends the reader to the reference instead of restating its fields', () => {
    expect(skill).toContain('https://leclap.dev/llms.txt');
  });

  // A third hand-maintained copy of the field reference (after the MCP's authoring guide and the
  // docs site) is the failure mode this skill is designed to avoid: it ships to user machines where
  // we can never update it, so it must not enumerate the schema.
  it('does not enumerate section fields', () => {
    expect(skill).not.toContain('colorsList');
    expect(skill).not.toContain('framingGuide');
    expect(skill).not.toContain('musicEnabled');
  });

  it('prefers the sugar tier over raw filters', () => {
    expect(skill).toContain('filters[]');
    expect(skill).toMatch(/transition.+look.+grade.+motion/s);
  });

  it('warns that a non-cut transition forces a full re-encode', () => {
    expect(skill).toMatch(/re-encode/i);
    expect(skill).toMatch(/stream[- ]copy/i);
  });

  // options.speed is a PTS multiplier, so 2 SLOWS the clip down — the inverse of what the field
  // name suggests, and the trap most likely to send an agent in the wrong direction silently.
  it('spells out the inverted speed multiplier', () => {
    expect(skill).toMatch(/speed/i);
    expect(skill).toMatch(/slow/i);
  });

  // global.audio.ducking.attack/release are the only millisecond fields in the descriptor, and they
  // live in the audio sugar tier this same skill tells the agent to prefer. An absolute
  // "never milliseconds" rule makes an agent write 0.02 for 20ms — a silent 1000x error.
  it('does not claim every duration is in seconds', () => {
    expect(skill).not.toMatch(/never milliseconds/i);
    expect(skill).toContain('ducking');
  });

  it('says where media is read from and written to', () => {
    expect(skill).toContain('assets/');
    expect(skill).toContain('build/');
  });

  it('shows how to pass variables in, and clips only where a clip slot exists', () => {
    expect(skill).toContain('--field');
    expect(starterSkill('demo', { remotion: true })).toContain('--video intro=');
  });

  // pnpm forwards a literal `--` to the script, and the CLI then stops parsing flags there: the flag is
  // dropped without an error. Only npm needs the separator (it eats it before the script sees it).
  it('separates forwarded flags with `--` only where the package manager needs it', () => {
    expect(starterSkill('demo', { packageManager: 'npm' })).toContain('npm run render -- --field');
    expect(starterSkill('demo', { packageManager: 'pnpm' })).toContain('pnpm render --field');
    expect(starterSkill('demo', { packageManager: 'pnpm' })).not.toContain('pnpm render -- ');
    expect(starterSkill('demo', { packageManager: 'yarn' })).toContain('yarn render --field');
    expect(starterSkill('demo', { packageManager: 'bun' })).toContain('bun run render --field');
  });

  it('names --set for declared fields', () => {
    expect(skill).toContain('--set');
  });

  // `leclap` is a devDependency, not a global install — a bare `leclap validate` in a scaffolded
  // project is `command not found`. Every command the skill prints must go through the package
  // manager, which puts node_modules/.bin on PATH.
  it('routes every command through the package manager', () => {
    // No bare `leclap …` anywhere: it is a devDependency, so only a script runner finds it.
    expect(skill).not.toMatch(/(^|[`|\s])leclap\s/);
    expect(skill).toMatch(/npm run (validate|render)/);
  });

  it('renders the detected package manager in its commands', () => {
    expect(starterSkill('demo', { packageManager: 'pnpm' })).toContain('pnpm validate');
    expect(starterSkill('demo', { packageManager: 'bun' })).toContain('bun run validate');
    expect(starterSkill('demo', { packageManager: 'npm' })).toContain('npm run render');
  });

  // /doc/schema is a client-rendered SPA — only <head> is pre-baked, so an agent fetching it gets a
  // shell with no schema in it. llms.txt is the authority built for machine retrieval.
  it('points a fetching agent at llms.txt, not the SPA route', () => {
    expect(skill).toContain('https://leclap.dev/llms.txt');
  });

  it('stays short enough to be read in full', () => {
    expect(skill.split('\n').length).toBeLessThan(130);
  });
});

describe('starterSkill — conditional sections', () => {
  it('documents the MCP loop only when the MCP is wired', () => {
    const withMcp = starterSkill('demo', { mcp: true });
    expect(withMcp).toContain('validate_template');
    expect(withMcp).toContain('compose_video');

    const without = starterSkill('demo');
    expect(without).not.toContain('compose_video');
  });

  it('points at get_template_schema as the authority only when the MCP is wired', () => {
    expect(starterSkill('demo', { mcp: true })).toContain('get_template_schema');
    expect(starterSkill('demo')).not.toContain('get_template_schema');
  });

  it('documents the Remotion intro hand-off only when Remotion is scaffolded', () => {
    const withRemotion = starterSkill('demo', { mcp: true, remotion: true });
    expect(withRemotion).toContain('render_remotion_clip');
    expect(withRemotion).toContain('userVideoPaths');
    expect(withRemotion).toContain('Intro');

    expect(starterSkill('demo', { mcp: true })).not.toContain('render_remotion_clip');
  });

  it('carries the project name so the guidance reads as this project', () => {
    expect(starterSkill('summer-reel')).toContain('summer-reel');
  });

  // starterFiles is exported API: {mcp:false, remotion:true} is reachable by a caller even though
  // init.run currently implies mcp from remotion. The Remotion guidance must follow the Remotion
  // scaffold, not the MCP flag.
  it('gates the Remotion hand-off on remotion, not on mcp', () => {
    const remotionOnly = starterSkill('demo', { remotion: true });
    expect(remotionOnly).toContain('remotion/Intro.tsx');
    expect(remotionOnly).not.toBe(starterSkill('demo'));
  });

  // The bare starter has one color_background section and no remotion/ directory, so guidance
  // referring to either has no referent and invites an agent to invent one.
  it('omits remotion and project_video guidance from the bare starter', () => {
    const bare = starterSkill('demo');
    expect(bare).not.toContain('remotion/');
    expect(bare).not.toContain('--video intro=');
    expect(bare).not.toContain('project_video');
  });

  // A directory name may legally contain ':' or '#'. Interpolated raw, either breaks the YAML and
  // the whole skill silently stops loading.
  it('quotes the description so an odd project name cannot break the frontmatter', () => {
    const skill = starterSkill('my: reel #2');
    const description = skill.split('\n').find((line) => line.startsWith('description:'));
    expect(description).toBe(
      'description: "Use when editing template.json in my: reel #2, adding or changing sections, transitions, looks, colour grading, motion or audio, or when a render fails or looks wrong."'
    );
  });
});

describe('agentsMd', () => {
  it('points at the skill rather than repeating it', () => {
    const md = agentsMd('demo');
    expect(md).toContain('.agents/skills/authoring-leclap-videos/SKILL.md');
    expect(md).toContain('demo');
    expect(md.split('\n').length).toBeLessThan(20);
  });
});
