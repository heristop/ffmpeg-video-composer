import type { McpServer } from '@modelcontextprotocol/server';
import { CAPABILITY_FEATURES } from 'ffmpeg-video-composer';
import { z } from 'zod';

import { localCapabilities } from '../compose/capabilities.js';

const featureSchema = z.object({
  usable: z.enum(['yes', 'no', 'unknown']),
  detail: z.string(),
  fix: z.string().optional(),
});

const outputSchema = z.object({
  ffmpeg: z.object({ path: z.string(), version: z.string().nullable() }),
  features: z
    .record(z.string(), featureSchema)
    .describe(
      `One entry per feature (${CAPABILITY_FEATURES.join(', ')}): usable yes/no/unknown, what the probe saw, the fix.`
    ),
  fonts: z.object({
    bundled: z.string().nullable(),
    freetype: z.boolean(),
    fontconfig: z.boolean(),
    harfbuzz: z.boolean(),
    fribidi: z.boolean(),
  }),
  encoders: z.array(z.string()),
});

// The capability doctor as a tool: what the local FFmpeg really renders (listings plus one-frame probes),
// the same JSON as `leclap diagnose --json`. Read-only; the probe is cached for the server's lifetime.
export function registerGetCapabilities(server: McpServer): void {
  server.registerTool(
    'get_capabilities',
    {
      title: 'Get Capabilities',
      description:
        'Report what the local FFmpeg that compose_video renders with can actually do: drawtext (with a ' +
        'bundled font), text shaping, libass, zscale/tonemap, lut3d, xfade, gblur, alphamerge, loudnorm, ' +
        'ebur128, libx264 and its colour params, GPL filters — each usable yes/no/unknown with what the probe ' +
        'saw and a fix — plus font support and encoders. Listings are verified with one-frame renders. ' +
        'validate_template uses the same probe to flag feature_unavailable. Call it when a render fails on a ' +
        'filter or before relying on text, LUT looks or designed transitions on an unknown machine.',
      outputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const report = await localCapabilities();

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }],
        structuredContent: report as unknown as Record<string, unknown>,
      };
    }
  );
}
