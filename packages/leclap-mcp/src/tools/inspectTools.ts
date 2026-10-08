import type { McpServer } from '@modelcontextprotocol/server';

import type { McpConfig } from '../config.js';
import { registerGetMotionCatalog } from './getMotionCatalog.js';
import { registerRenderFrames } from './renderFrames.js';

// The lookup and inspection tools: the motion catalog and its search (get_motion_catalog, which logs the
// queries it could not answer) and a look at the render (render_frames). The timeline and the resolved
// descriptor are validate_template `include` options. Always registered.
export function registerInspectTools(server: McpServer, config: McpConfig): void {
  registerGetMotionCatalog(server, config);
  registerRenderFrames(server, config);
}
