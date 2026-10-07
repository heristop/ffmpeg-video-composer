import { describe, expect, it } from 'vitest';
import { buildBuilderTools } from '@/application/usecases/webmcp/registry';
import { BUILDER_TOOL_NAMES, SHARED_WITH_MCP } from '@/application/usecases/webmcp/tool-names';
import { ALL_CAPABILITIES, createFakePort, TEST_ORIGIN } from '@/application/usecases/webmcp/fake-port';
import serverManifest from '../../../../../../packages/leclap-mcp/server.json';
import { webMcpTools } from './webmcpDocs';

const registered = buildBuilderTools(createFakePort(), { capabilities: ALL_CAPABILITIES, origin: TEST_ORIGIN });
const mcpTools: string[] = serverManifest._meta['io.modelcontextprotocol.registry/publisher-provided'][
  'dev.leclap.video'
].tools.map((tool: { name: string }) => tool.name);

describe('webMcpTools', () => {
  it('documents exactly the tools the builder registers, in the registry order', () => {
    expect(webMcpTools.map((tool) => tool.name)).toEqual([...BUILDER_TOOL_NAMES]);
    expect(registered.map((tool) => tool.name).sort()).toEqual([...BUILDER_TOOL_NAMES].sort());
  });

  it('states each tool’s kind and confirmation as the registry applies them', () => {
    const byName = new Map(registered.map((tool) => [tool.name, tool]));

    for (const doc of webMcpTools) {
      expect({ name: doc.name, kind: byName.get(doc.name)?.kind, confirm: byName.get(doc.name)?.confirm }).toEqual({
        name: doc.name,
        kind: doc.kind,
        confirm: doc.confirm,
      });
    }
  });

  it('marks as shared exactly the names @leclap/mcp also registers with the same meaning', () => {
    const shared = webMcpTools.filter((tool) => tool.sharedWithMcp).map((tool) => tool.name);

    expect(shared.sort()).toEqual([...SHARED_WITH_MCP].sort());

    for (const name of shared) expect(mcpTools).toContain(name);
  });
});
