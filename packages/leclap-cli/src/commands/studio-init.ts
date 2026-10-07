import path from 'node:path';
import pc from 'picocolors';
import { scaffoldStudio } from './studio.js';
import { fail, hint, step, success } from '../ui.js';
import { wordmark } from '../theme.js';

/** `leclap init --studio <dir>`: write the production folder and print the first steps. */
export async function runStudioInit(target: string): Promise<void> {
  const dir = path.resolve(process.cwd(), target);

  process.stdout.write(wordmark());

  try {
    await scaffoldStudio(dir);
  } catch (error) {
    console.error(fail((error as Error).message));
    process.exit(1);
  }

  console.log(`\n${success(`Created studio ${pc.bold(target)}`)}\n`);
  console.log(hint('Next steps'));
  console.log(step('fill brief.md (approved assets and copy), then style-guide.md and shotlist.md'));
  console.log(step('drop approved files into assets/'));
  console.log(step(`leclap studio status ${target}`));
  console.log('');
}
