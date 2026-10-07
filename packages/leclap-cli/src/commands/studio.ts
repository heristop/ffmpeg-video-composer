import { defineCommand } from 'citty';
import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { studioFiles } from '../studio-files.js';
import { passGate, studioStatus, type StudioStatus } from '../studio.js';
import { fail, heading, hint, step, success } from '../ui.js';

/** Writes the studio folder (`leclap init --studio <dir>`); refuses a non-empty directory. */
export async function scaffoldStudio(dir: string, now: Date = new Date()): Promise<string[]> {
  const entries = await fs.readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];

    throw error;
  });

  if (entries.length > 0) throw new Error(`${dir} already exists and is not empty`);

  const files = studioFiles(path.basename(dir), now);

  await Promise.all(
    Object.entries(files).map(async ([relative, contents]) => {
      const target = path.join(dir, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents);
    })
  );

  return Object.keys(files);
}

/** The status report as lines: every gate, then the next one and what it still misses. */
export function formatStudioStatus(status: StudioStatus): string[] {
  const lines = [heading(`Studio ${status.name}`), ''];

  for (const entry of status.gates) {
    const mark = entry.passedAt ? pc.green('✓') : pc.dim('○');
    lines.push(`${mark} ${entry.gate.id.padEnd(16)} ${entry.passedAt ? hint(entry.passedAt) : ''}`.trimEnd());
  }

  lines.push('');

  if (!status.next) return [...lines, success('Delivered: every gate is passed.')];

  lines.push(`Next gate: ${pc.bold(status.next.gate.id)} (${status.next.gate.label})`);

  if (status.next.missing.length === 0) {
    return [...lines, step(`artifacts ready: run \`leclap studio pass ${status.next.gate.id}\``)];
  }

  return [...lines, 'Missing:', ...status.next.missing.map((artifact) => step(artifact.label))];
}

const dirArg = {
  type: 'positional',
  description: 'Studio folder (default: current directory)',
  required: false,
  default: '.',
} as const;

const status = defineCommand({
  meta: { name: 'status', description: 'Show passed gates, the next gate and its missing artifacts' },
  args: { dir: dirArg },
  run({ args }) {
    try {
      console.log(formatStudioStatus(studioStatus(path.resolve(args.dir))).join('\n'));
    } catch (error) {
      console.error(fail((error as Error).message));
      process.exit(1);
    }
  },
});

const pass = defineCommand({
  meta: { name: 'pass', description: 'Record a gate as passed (in order, once its artifacts exist)' },
  args: {
    gate: { type: 'positional', description: 'Gate id, e.g. assets-approved', required: true },
    dir: dirArg,
    force: { type: 'boolean', description: 'Pass even when artifacts are missing' },
  },
  run({ args }) {
    try {
      const manifest = passGate(path.resolve(args.dir), args.gate, { force: args.force });
      console.log(success(`${args.gate} passed at ${manifest.gates[args.gate]}`));
    } catch (error) {
      console.error(fail((error as Error).message));
      process.exit(1);
    }
  },
});

export const studio = defineCommand({
  meta: { name: 'studio', description: 'Production gates of a studio folder (see `leclap init --studio`)' },
  subCommands: { status, pass },
});
