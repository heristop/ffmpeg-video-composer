import type { McpServer } from '@modelcontextprotocol/server';
import { invalidTemplateText, videoTimeline } from 'ffmpeg-video-composer';
import { z } from 'zod';

import { applyComposeFormat, formatArg } from '../compose/format.js';
import { validateTemplate } from '../compose/validation.js';

// get_timeline: where everything sits on the whole video, without rendering — each section's absolute
// start/end, every motion event (kinetic, graphic, camera, reveal, exit, transition) on video seconds,
// the beat grid and the named cues. What an agent needs to pick render_frames moments or to line a hit
// up with a beat.

const inputSchema = z.object({ template: z.record(z.string(), z.unknown()), format: formatArg });

export function timelineResult(template: Record<string, unknown>, format?: string) {
  const formatted = applyComposeFormat({ template, format });

  if ('isError' in formatted) return formatted;

  const validation = validateTemplate(formatted.template);

  if (!validation.ok) {
    return { isError: true as const, content: [{ type: 'text' as const, text: invalidTemplateText(validation) }] };
  }

  const timeline = videoTimeline(validation.descriptor);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(timeline) }],
    structuredContent: timeline as unknown as Record<string, unknown>,
  };
}

export function registerGetTimeline(server: McpServer): void {
  server.registerTool(
    'get_timeline',
    {
      title: 'Get Timeline',
      description:
        'Return the template timeline on whole-video seconds, render-free: sections with absolute start/end ' +
        '(transitions overlap the clips they join), every motion event (kinetic, graphic, camera, reveal, exit, ' +
        'transition) with its window and ease, the global.beats grid and the section cues. `approx` is true when ' +
        'a clip length is assumed. Use it to choose render_frames moments and to align hits with beats.',
      inputSchema,
    },
    (args: z.infer<typeof inputSchema>) => timelineResult(args.template, args.format)
  );
}
