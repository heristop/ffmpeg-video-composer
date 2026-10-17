// `leclap reference <clip>`: read a reference clip's format — shots, rhythm, transitions, grounds, where
// the main element sits — and print it as binding rules for an agent or the builder. `--check` holds a
// template to it. The format only: never the reference's subjects, logos or text.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineCommand } from 'citty';
import {
  analyzeStructureFile,
  expandPartialsSafe,
  resolveFormat,
  structureDrift,
  structurePromptRules,
  videoTimeline,
  type ReferenceStructure,
} from 'ffmpeg-video-composer';
import { wordmark } from '../theme.js';
import { fail, heading, hint, step, success } from '../ui.js';

export function formatStructureSummary(structure: ReferenceStructure): string[] {
  const { rhythm } = structure;

  return [
    heading(
      `${rhythm.shots} shots over ${structure.duration} s · average ${rhythm.avgShot} s · ${rhythm.cutsPerMinute} cuts/min`
    ),
    ...structure.shots.map((shot) =>
      step(
        `${String(shot.index + 1).padStart(2)}  ${String(shot.duration).padStart(5)} s  ${shot.ground.padEnd(5)}  ${shot.anchor.padEnd(12)}  motion ${shot.motion}${shot.transitionIn ? `  ← ${shot.transitionIn}` : ''}`
      )
    ),
  ];
}

export function templateSections(templateJson: unknown): { name: string; duration: number; durationKnown: boolean }[] {
  const expansion = expandPartialsSafe(templateJson);

  if (!expansion.ok) throw new Error(expansion.error.message);

  const resolved = resolveFormat(expansion.data);

  if (resolved.issues.length > 0) throw new Error(resolved.issues.map((issue) => issue.message).join('; '));

  // On-screen length, as the reference's shots are measured: a transition pulls the next section back
  // over this one, so a section is seen from its start to the next one's.
  const { sections } = videoTimeline(resolved.descriptor);

  return sections.map((section, i) => ({
    name: section.name,
    duration: Number(((sections[i + 1]?.start ?? section.end) - section.start).toFixed(6)),
    durationKnown: section.durationKnown,
  }));
}

export const reference = defineCommand({
  meta: { name: 'reference', description: "Read a reference clip's format (shots, rhythm, layout) as binding rules" },
  args: {
    clip: {
      type: 'positional',
      description: 'Reference clip (a local file you have the right to use)',
      required: true,
    },
    json: { type: 'boolean', description: 'Emit the structure as JSON', default: false },
    out: { type: 'string', alias: 'o', description: 'Write the binding rules to a text file for an agent prompt' },
    check: { type: 'string', description: 'Template JSON to hold to the reference (exit 1 on drift)' },
  },
  async run({ args }) {
    try {
      const clip = path.resolve(args.clip);

      if (!existsSync(clip)) throw new Error(`Reference not found: ${args.clip}`);

      const structure = await analyzeStructureFile(clip);
      const rules = structurePromptRules(structure);

      process.stdout.write(
        args.json
          ? `${JSON.stringify(structure, null, 2)}\n`
          : `${wordmark()}${formatStructureSummary(structure).join('\n')}\n\n${rules}\n`
      );

      if (args.out) {
        await writeFile(args.out, `${rules}\n`);
        console.error(success(`Wrote ${args.out}`));
      }

      if (!args.check) return;

      const issues = structureDrift(templateSections(JSON.parse(await readFile(args.check, 'utf8'))), structure);

      if (issues.length === 0) {
        console.error(success(`${args.check} follows the reference's format`));

        return;
      }

      for (const issue of issues) console.error(fail(issue.message));
      console.error(hint('Match the section count and lengths to the shots above.'));
      process.exitCode = 1;
    } catch (error) {
      console.error(fail(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  },
});
