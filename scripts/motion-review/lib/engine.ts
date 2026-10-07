import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Which engine renders a run: the current checkout (built on demand with --build) or a git ref, exported
// once into a cached directory (git archive) and built there, so `--ref <sha>` "before" sheets compare
// against the same fixtures rendered by an older engine.

export interface Engine {
  /** Checkout whose engine, CLI and bundled templates are used. */
  root: string;
  /** The CLI entry (`packages/leclap-cli/dist/index.js`). */
  cli: string;
  /** Human label for the index: the commit and its subject. */
  describe: string;
}

const CLI = 'packages/leclap-cli/dist/index.js';

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function build(root: string): void {
  process.stdout.write(`  building engine and CLI in ${root}\n`);
  run('pnpm', ['--filter', 'ffmpeg-video-composer', 'build'], root);
  run('pnpm', ['--filter', '@leclap/cli', 'build'], root);
}

function newestMtime(dir: string): number {
  let newest = 0;

  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) newest = Math.max(newest, statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
  }

  return newest;
}

function warnIfStale(root: string): void {
  const dist = path.join(root, 'packages/ffmpeg-video-composer/dist/index.js');
  const src = path.join(root, 'packages/ffmpeg-video-composer/src');

  if (existsSync(dist) && newestMtime(src) > statSync(dist).mtimeMs) {
    process.stdout.write('  warning: engine sources are newer than its dist; pass --build to rebuild\n');
  }
}

function describe(root: string): string {
  return run('git', ['log', '-1', '--format=%h %s'], root);
}

/** The current checkout's engine; builds it when asked or when the CLI was never built. */
export function currentEngine(root: string, rebuild: boolean): Engine {
  if (rebuild || !existsSync(path.join(root, CLI))) build(root);

  warnIfStale(root);

  return { root, cli: path.join(root, CLI), describe: `${describe(root)} (working tree)` };
}

/** The engine at `ref`, in `<cacheDir>/engines/<sha>` (exported, installed and built on first use). */
export function engineAtRef(repoRoot: string, ref: string, cacheDir: string): Engine {
  const sha = run('git', ['rev-parse', '--verify', `${ref}^{commit}`], repoRoot);
  const root = path.join(cacheDir, 'engines', sha.slice(0, 12));

  if (!existsSync(path.join(root, CLI))) {
    // A plain export (git archive), not a worktree: nothing is registered in the repository.
    mkdirSync(root, { recursive: true });
    execFileSync('sh', ['-c', `git archive --format=tar ${sha} | tar -x -C "${root}"`], { cwd: repoRoot });
    run('pnpm', ['install', '--offline', '--frozen-lockfile'], root);
    build(root);
  }

  return { root, cli: path.join(root, CLI), describe: run('git', ['log', '-1', '--format=%h %s', sha], repoRoot) };
}
