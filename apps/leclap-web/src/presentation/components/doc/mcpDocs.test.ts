import { describe, expect, it } from 'vitest';
import { mcpDoc } from './mcpDocs';
import serverManifest from '../../../../../../packages/leclap-mcp/server.json';

describe('mcpDoc', () => {
  it('documents the MCP authoring and rendering flow', () => {
    expect(mcpDoc.id).toBe('mcp');
    expect(mcpDoc.title).toContain('MCP');
    expect(mcpDoc.flow).toEqual([
      'list_samples',
      'get_sample',
      'get_template_schema',
      'validate_template',
      'compose_video',
    ]);
  });

  it('documents the agentic PR evidence recipe without claiming upload support', () => {
    expect(mcpDoc.agenticReview.steps).toEqual([
      'collect implementation evidence',
      'author the review template',
      'validate_template',
      'compose_video',
      'attach the returned outputPath to the PR or MR',
    ]);
    expect(mcpDoc.agenticReview.uploadBoundary).toContain('does not upload');
  });

  it('includes every tool the server registers', () => {
    const toolNames = mcpDoc.tools.map((tool) => tool.name);

    const registered = serverManifest._meta['io.modelcontextprotocol.registry/publisher-provided']['dev.leclap.video'];
    expect([...toolNames].sort()).toEqual(registered.tools.map((tool) => tool.name).sort());
  });

  it('documents every published MCP environment setting', () => {
    const published = serverManifest.packages[0].environmentVariables.map((entry) => entry.name);
    expect(mcpDoc.config.map((entry) => entry.env).sort()).toEqual(published.sort());
  });

  it('no longer documents the removed catalog / storyboard tools', () => {
    const toolNames = mcpDoc.tools.map((tool) => tool.name);

    expect(toolNames).not.toContain('list_templates');
    expect(toolNames).not.toContain('get_remotion_authoring_guide');
    expect(toolNames).not.toContain('draft_template_from_remotion_storyboard');
  });

  it('marks the three Remotion tools as opt-in', () => {
    const optIn = mcpDoc.tools.filter((tool) => tool.optIn).map((tool) => tool.name);

    expect(optIn.sort()).toEqual(['get_effect_schema', 'render_preview', 'render_remotion_clip']);
  });

  it('names each tool arguments so an agent knows what to pass', () => {
    const compose = mcpDoc.tools.find((tool) => tool.name === 'compose_video');

    expect(compose?.args).toBe('template, fields?, userVideoPaths?, locale?, outputBaseName?, expectedRevision?');
    expect(mcpDoc.tools.every((tool) => tool.args.length > 0)).toBe(true);
  });

  // The media dir defaults to a narrow ~/.leclap/media, NOT the home directory — documenting the
  // wider default would tell readers the server reads all of $HOME by default.
  it('reports the narrow media-dir default', () => {
    const mediaDir = mcpDoc.config.find((entry) => entry.env === 'LECLAP_MCP_MEDIA_DIR');

    expect(mediaDir?.fallback).toBe('~/.leclap/media');
    expect(mediaDir?.flag).toBe('--media-dir');
  });

  it('documents the Remotion opt-in, without which render_remotion_clip never registers', () => {
    const optIn = mcpDoc.config.find((entry) => entry.env === 'LECLAP_MCP_ALLOW_REMOTION');

    expect(optIn?.flag).toBe('--allow-remotion');
    expect(optIn?.fallback).toBe('off');
  });

  // The tool's output schema gained `geometry` without this page mentioning it, so the reference
  // described a return shape the server had stopped producing. Pinned here because the drift is
  // silent: nothing else on the site reads these strings.
  it('documents the geometry findings validate_template returns', () => {
    const validate = mcpDoc.tools.find((tool) => tool.name === 'validate_template');

    expect(validate?.purpose).toContain('geometry');
    expect(validate?.when).toContain('advisory');
  });

  it('ships configs whose env paths are absolute — they are not tilde-expanded', () => {
    for (const raw of [mcpDoc.sampleConfig, mcpDoc.projectConfig]) {
      const parsed = JSON.parse(raw) as { mcpServers: { leclap: { env: Record<string, string> } } };
      const paths = Object.entries(parsed.mcpServers.leclap.env).filter(([key]) => key.endsWith('_DIR'));

      expect(paths.length).toBeGreaterThan(0);
      expect(paths.every(([, value]) => value.startsWith('/'))).toBe(true);
    }
  });
});
