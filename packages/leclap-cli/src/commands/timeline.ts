import { defineCommand } from 'citty';
import fs from 'node:fs/promises';
import { expandPartialsSafe, resolveFormat, videoTimeline } from 'ffmpeg-video-composer';
import { formatTimeline } from '../snapshot-args.js';
import { emitFailure, formatName } from './snapshot.js';

// `leclap timeline <template> [--json]`: where everything sits on the whole video — each section's
// absolute start/end, every motion event, beats and cues — without rendering.

export const timeline = defineCommand({
  meta: { name: 'timeline', description: 'Print a template timeline: sections, motion events, beats and cues' },
  args: {
    template: { type: 'positional', description: 'Path to a template JSON file', required: true },
    json: { type: 'boolean', description: 'Emit the timeline as JSON', default: false },
    format: { type: 'string', description: 'Time one format of the template: landscape | portrait | square' },
  },
  async run({ args }) {
    try {
      const expansion = expandPartialsSafe(JSON.parse(await fs.readFile(args.template, 'utf8')));

      if (!expansion.ok) throw new Error(expansion.error.message);

      const format = args.format === undefined ? undefined : formatName(args.format);
      const resolved = resolveFormat(expansion.data, format);

      if (resolved.issues.length > 0) throw new Error(resolved.issues.map((issue) => issue.message).join('; '));

      const result = videoTimeline(resolved.descriptor);

      process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `${formatTimeline(result).join('\n')}\n`);
    } catch (error) {
      emitFailure(error, args.json);
    }
  },
});
