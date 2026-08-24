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
    expect(skill).toMatch(/^description: Use when .+/m);
  });

  // Agents scan before they read. The checklist facts — which command, which directory — belong in a
  // table at the top, not buried in prose three sections down.
  it('opens with a scannable quick-reference table', () => {
    // Everything above the first `##` — the table has to be reachable without reading a section.
    const preamble = skill.slice(0, skill.indexOf('\n## '));
    expect(preamble).toMatch(/^\| --- \| --- \|$/m);
    expect(preamble).toMatch(/^\| Render \|/m);
  });

  it('names the validate → render loop', () => {
    expect(skill).toContain('leclap validate template.json');
    expect(skill).toContain('leclap render template.json');
  });

  it('sends the reader to the schema instead of restating its fields', () => {
    expect(skill).toContain('https://leclap.dev/doc/schema');
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

  it('says where media is read from and written to', () => {
    expect(skill).toContain('assets/');
    expect(skill).toContain('build/');
  });

  it('shows how to pass variables and clips in', () => {
    expect(skill).toContain('--field');
    expect(skill).toContain('--video');
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
});

describe('agentsMd', () => {
  it('points at the skill rather than repeating it', () => {
    const md = agentsMd('demo');
    expect(md).toContain('.agents/skills/authoring-leclap-videos/SKILL.md');
    expect(md).toContain('demo');
    expect(md.split('\n').length).toBeLessThan(20);
  });
});
