import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';

import { loadCustomEffectCatalog } from './effects/custom-effect-catalog.js';
import type { McpConfig } from './config.js';
import { registerGetTemplateSchema } from './tools/getTemplateSchema.js';
import { registerCompose } from './tools/composeVideo.js';
import { registerProbe } from './tools/probeMedia.js';
import { registerExtractStyle } from './tools/extractStyle.js';
import { registerAnalyzeMusic } from './tools/analyzeMusic.js';
import { registerAnalyzeSound } from './tools/analyzeSound.js';
import { registerGetCapabilities } from './tools/getCapabilities.js';
import { registerValidateTemplate } from './tools/validateTemplate.js';
import { registerRenderRemotionClip } from './tools/renderRemotionClip.js';
import { registerGetEffectSchema } from './tools/getEffectSchema.js';
import { registerRenderPreview } from './tools/renderPreview.js';
import { registerPatchTemplate } from './tools/patchTemplate.js';
import { registerEditTemplate } from './tools/editTemplate.js';
import { validateEffects } from './effects/title-registry.js';
import { registerSamples } from './tools/samples.js';
import { registerComposeGuide } from './prompts/composeGuide.js';
import { registerInspectTools } from './tools/inspectTools.js';

// Each tool group is registered by a small `registerXxx(server, config)` function, called from
// `createServer`. The surface is authoring-only: schema, validate, compose, probe, the Remotion
// authoring helpers, and a health-check ping.
function registerPing(server: McpServer, _config: McpConfig): void {
  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Health check — returns a fixed readiness string.',
    },
    () => ({
      content: [{ type: 'text', text: 'leclap mcp ok' }],
    })
  );
}

// The tool/prompt surface is fixed for the process lifetime (only `allowRemotion`, a start-up
// config, changes it), so the 2026-07-28 `CacheableResult` fields can advertise a real freshness
// window instead of the SDK's conservative `ttlMs: 0`. `private` because the listing depends on this
// server's configuration — no shared intermediary should serve it to another client.
const LIST_CACHE_HINT = { ttlMs: 300_000, cacheScope: 'private' } as const;

// `serverInfo.version` is what every MCP client displays and what the registry listing shows, so it
// has to be the real package version. It was a hardcoded '0.1.0' and had drifted three minor
// releases behind before a pre-release handshake caught it. Read at runtime via createRequire rather
// than imported: tsdown bundles this file into dist/index.js, and a static import would inline the
// version at build time (drifting again the moment the package is bumped) or make the bundler try to
// resolve the manifest as a module. From dist/, '../package.json' is the published manifest.
const SERVER_VERSION: string = createRequire(import.meta.url)('../package.json').version;

// Side-effect-free: builds and configures the server but does NOT connect a transport, so it
// stays unit-testable. The caller (index.ts) hands it to `serveStdio` as a per-connection factory.
export function snapshotEffectConfig(input: McpConfig): Readonly<McpConfig> {
  return Object.freeze({
    ...input,
    ...(input.effectCatalog === undefined && input.effectCatalogPath
      ? { effectCatalog: loadCustomEffectCatalog(input.effectCatalogPath) }
      : {}),
  });
}
// Revision-guarded template edits: patch_template (registered effect props) and edit_template (JSON Patch).
// Both stay registered without Remotion; effect sections they produce still pass effect-backend validation.
function registerTemplateEdits(server: McpServer, config: McpConfig): void {
  async function effects(template: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    await validateEffects(template, config, signal);
  }

  registerPatchTemplate(server, effects);
  registerEditTemplate(server, effects);
}

// Media inspection and measurement: probe a file, extract a reference style, time music, hear a sound.
function registerMediaAnalysis(server: McpServer, config: McpConfig): void {
  registerProbe(server, config);
  registerExtractStyle(server, config);
  registerAnalyzeMusic(server, config);
  registerAnalyzeSound(server, config);
}

export function createServer(input: McpConfig): McpServer {
  const config = snapshotEffectConfig(input);
  const server = new McpServer(
    { name: 'leclap', version: SERVER_VERSION },
    {
      capabilities: { tools: {}, prompts: {} },
      cacheHints: {
        'tools/list': LIST_CACHE_HINT,
        'prompts/list': LIST_CACHE_HINT,
        'server/discover': LIST_CACHE_HINT,
      },
    }
  );

  registerPing(server, config);
  registerSamples(server);
  registerGetTemplateSchema(server);
  registerValidateTemplate(server, config);
  registerCompose(server, config);
  registerInspectTools(server, config);

  if (config.allowRemotion) {
    registerGetEffectSchema(server, config);
    registerRenderPreview(server, config);
  }
  registerTemplateEdits(server, config);
  registerMediaAnalysis(server, config);
  registerGetCapabilities(server);

  // render_remotion_clip bundles + executes a caller-supplied entry (arbitrary local JS) — an RCE
  // surface. Register it only when the operator explicitly opted in for trusted local design-time use.
  if (config.allowRemotion) {
    registerRenderRemotionClip(server, config);
  }

  registerComposeGuide(server);

  return server;
}
