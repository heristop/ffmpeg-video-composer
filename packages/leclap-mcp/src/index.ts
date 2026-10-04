// Must precede any import that reaches the core (`ffmpeg-video-composer`): the core uses tsyringe,
// which requires a reflect-metadata polyfill at load time. `get_template_schema` imports the core's
// TemplateDescriptorSchema value, so the polyfill has to be installed before the server module loads.
import 'reflect-metadata';
// MUST stay above ./server.js (and anything pulling in ffmpeg-video-composer): importing this runs
// installStdoutGuard() before the core's import graph is evaluated, so a load-time stdout write from
// the core can't corrupt the JSON-RPC framing. `out` is the genuine fd-1 writer for the transport.
import { out } from './stdout-guard-install.js';
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio';

import { loadConfig } from './config.js';
import { createServer, snapshotEffectConfig } from './server.js';

// The tool surface is authoring-only (get_template_schema, validate_template, compose_video,
// probe_media, the Remotion authoring helpers, ping). All diagnostics go to stderr — never
// `console.log`, which the guard would divert anyway.
//
// `serveStdio` owns the connection instead of the v1 `server.connect(transport)` wiring: the
// 2026-07-28 revision dropped the `initialize` handshake, so the era is decided per connection from
// the opening message. Passing the factory lets the SDK serve both the stateless 2026-07-28 protocol
// and 2025-era clients (Claude Desktop and friends still in the older revision) from one definition.
// The transport is supplied explicitly so the JSON-RPC channel keeps writing through the stdout
// guard's genuine fd-1 writer rather than the hijacked `process.stdout`.
function main(): void {
  // Fail catalog configuration before stdin/transport starts; the protocol factory is lazy.
  const config = snapshotEffectConfig(loadConfig());

  serveStdio(() => createServer(config), {
    transport: new StdioServerTransport(process.stdin, out),
    onerror: (error) => {
      console.error(error);
    },
  });
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exit(1);
}
