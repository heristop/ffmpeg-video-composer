// @leclap/cli entry point, built by tsdown into dist/index.js (shebang added via the `banner` option).
// `leclap` is an umbrella dev tool — subcommands (render / diagnose / …) plus a bare-path shorthand
// so `leclap my-template.json` still renders.

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { defineCommand, runMain } from 'citty';
import { rewriteArgv, KNOWN_COMMANDS } from './args.js';
import { wordmark } from './theme.js';
import { render } from './commands/render.js';
import { init } from './commands/init.js';
import { diagnose } from './commands/diagnose.js';
import { validate } from './commands/validate.js';
import { samples } from './commands/samples.js';
import { verify } from './commands/verify.js';
import { style } from './commands/style.js';
import { studio } from './commands/studio.js';
import { beats } from './commands/beats.js';
import { snapshot } from './commands/snapshot.js';
import { compare } from './commands/compare.js';
import { timeline } from './commands/timeline.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const main = defineCommand({
  meta: { name: 'leclap', version, description: 'create videos from JSON templates' },
  subCommands: { render, init, diagnose, validate, samples, verify, style, studio, beats, snapshot, compare, timeline },
});

const rawArgs = rewriteArgv(process.argv.slice(2), KNOWN_COMMANDS);
// Brand the root help/version screen with the wordmark. The subcommands print their own, so only do it
// here when no subcommand runs — empty argv or a top-level flag (`--help`, `-h`, `--version`).
const showsRootScreen = rawArgs.length === 0 || rawArgs[0].startsWith('-');

if (showsRootScreen) {
  process.stdout.write(wordmark());
}

try {
  await runMain(main, { rawArgs });
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
}
