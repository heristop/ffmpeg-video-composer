import type { McpServer } from '@modelcontextprotocol/server';

import type { McpConfig } from '../config.js';
import { registerGetMotionCatalog } from './getMotionCatalog.js';
import { registerGetTimeline } from './getTimeline.js';
import { registerGetResolvedTemplate } from './getResolvedTemplate.js';
import { registerRenderFrames } from './renderFrames.js';
import { registerReportCatalogGap } from './reportCatalogGap.js';

// The lookup and inspection tools: the motion catalog and its search (get_motion_catalog), what it could
// not answer (report_catalog_gap), a template's timeline (get_timeline), its resolved fields (get_resolved_template) and a look at the render
// (render_frames). Always registered.
export function registerInspectTools(server: McpServer, config: McpConfig): void {
  registerGetMotionCatalog(server);
  registerReportCatalogGap(server, config);
  registerGetTimeline(server);
  registerGetResolvedTemplate(server);
  registerRenderFrames(server, config);
}
