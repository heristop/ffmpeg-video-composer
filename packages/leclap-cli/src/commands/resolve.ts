import { defineCommand } from 'citty';
import fs from 'node:fs/promises';
import { findingLine, resolveTemplate } from 'ffmpeg-video-composer';
import { collectRepeated, parseKeyValues } from '../render-args.js';
import { parseFormatFlag } from '../render-formats.js';
import { emitFailure } from './snapshot.js';
import { fail, step } from '../ui.js';

// `leclap resolve <template> [--set name=value …] [--format …]`: the descriptor the build starts from, printed
// as JSON — partials expanded, declared fields (global.fields) filled with their typed values, the format
// resolved; variables and form values stay as placeholders. Exits 1, with one line per problem on stderr,
// when the render would refuse the values.

export interface ResolveReport {
  ok: boolean;
  stdout: string;
  stderr: string[];
}

export function resolveReport(template: unknown, sets: string[], format?: string): ResolveReport {
  const result = resolveTemplate(template, parseKeyValues(sets, 'set'), { format });
  const stderr = result.errors.map((error) => findingLine(error));

  return { ok: stderr.length === 0, stdout: `${JSON.stringify(result.descriptor, null, 2)}\n`, stderr };
}

export const resolve = defineCommand({
  meta: { name: 'resolve', description: 'Print a template with its fields filled in, as a render would see it' },
  args: {
    template: { type: 'positional', description: 'Path to a template JSON file', required: true },
    set: { type: 'string', description: 'Value for a declared field: --set name=value (repeatable)' },
    format: { type: 'string', description: 'Check one format of the template: landscape | portrait | square' },
  },
  async run({ args, rawArgs }) {
    try {
      const template: unknown = JSON.parse(await fs.readFile(args.template, 'utf8'));
      const format = args.format === undefined ? undefined : parseFormatFlag(args.format);
      const report = resolveReport(template, collectRepeated(rawArgs, 'set'), format);

      process.stdout.write(report.stdout);

      if (report.ok) return;

      console.error(fail(`${report.stderr.length} problem(s) a render would refuse`));

      for (const line of report.stderr) console.error(step(line));

      process.exitCode = 1;
    } catch (error) {
      emitFailure(error, false);
    }
  },
});
