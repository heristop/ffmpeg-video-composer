// #22 render_frames (experimental): JPEG stills grabbed from the preview the agent itself rendered, so it
// can look at composition and contrast. The user already allowed that preview, so no new dialog; without
// one (or once the user closed it) the tool says to call render_preview. Frames come back as image
// content (each ≤ 200 KB) next to a text part, because agents that cannot read images still get the facts.
import { z } from 'zod';
import { MAX_FRAME_BYTES } from '@/infrastructure/webmcp/frame-capture';
import { ok, fail } from './results';
import { defineTool, type ImageContent, type TextContent } from './types';

export const RENDER_FRAMES = defineTool({
  name: 'render_frames',
  title: 'Render Frames',
  description:
    `Experimental. Return up to 4 JPEG stills (≤${String(MAX_FRAME_BYTES / 1024)} KB each) of the preview ` +
    'you rendered with render_preview, at `at` seconds on the whole video (clamped to its length), as image content plus a text summary. Needs a ' +
    'completed render_preview whose dialog is still open; covered by that preview’s consent.',
  kind: 'consequential',
  confirm: 'never',
  requires: 'preview-render',
  input: z.object({
    at: z.array(z.number().min(0).max(3600)).min(1).max(4).describe('Seconds on the whole video.'),
  }),
  run: async (args, { port, signal }) => {
    const outcome = await port.captureFrames?.(args.at, signal);

    if (!outcome || outcome.status === 'no_preview') {
      return fail('not_found', 'No preview from this agent is open.', {
        hint: 'Call render_preview first; frames come from the preview it opens.',
      });
    }

    if (outcome.status === 'failed') return fail('unavailable', outcome.failure);

    const frames = outcome.frames.map(({ data: _data, ...frame }) => ({ ...frame, mimeType: 'image/jpeg' }));
    const summary = ok(
      { durationSeconds: outcome.durationSeconds, frames },
      `${String(frames.length)} frame(s) of a ${String(outcome.durationSeconds)} s preview at ${frames
        .map((frame) => `${String(frame.at)} s`)
        .join(', ')}.`
    );
    const images: ImageContent[] = outcome.frames.map((frame) => ({
      type: 'image',
      data: frame.data,
      mimeType: 'image/jpeg',
    }));

    return { ...summary, content: [...(summary.content as TextContent[]), ...images] };
  },
});
