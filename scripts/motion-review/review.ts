// Motion review harness: render every library effect fixture (fixtures/*.json) on three backgrounds in
// three formats, plus every bundled template, as 3×2 contact sheets via `leclap snapshot`, and write a
// static index.html that puts runs (before / after) side by side. No LFS needed: pointer media get
// stand-ins, pointer animations are reported as "pointer, not rendered". See README.md.
//
//   pnpm motion:review --before HEAD --out <dir>     # baseline column, engine at HEAD
//   pnpm motion:review --out <dir>                   # after column, current working tree
//   pnpm motion:review --only sheen --formats portrait
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptions, USAGE } from './lib/args.ts';
import { currentEngine, engineAtRef, type Engine } from './lib/engine.ts';
import { effectJobs, loadFixtures } from './lib/fixtures.ts';
import { writeIndex } from './lib/index-html.ts';
import { prepareStage } from './lib/media.ts';
import { renderAll } from './lib/render.ts';
import { templateJobs } from './lib/templates.ts';
import type { ManifestEntry, RenderJob, ReviewOptions, RunManifest } from './lib/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const cacheDir = path.join(os.tmpdir(), 'leclap-motion-review-cache');

function selectJobs(options: ReviewOptions, engine: Engine, stage: string): RenderJob[] {
  const jobs = [
    ...(options.templates ? templateJobs(engine.root, options, stage) : []),
    ...(options.effects ? effectJobs(loadFixtures(path.join(here, 'fixtures')), options) : []),
  ];

  if (options.only.length === 0) return jobs;

  return jobs.filter((job) => options.only.some((text) => job.key.includes(text)));
}

function copyShowcase(source: string, out: string): void {
  const dir = path.join(out, 'showcase');

  mkdirSync(dir, { recursive: true });

  for (const file of readdirSync(source).filter((name) => name.endsWith('.png'))) {
    copyFileSync(path.join(source, file), path.join(dir, file));
  }
}

// A filtered run (--only, --formats…) updates its rows in the label's manifest and keeps the others.
function mergeEntries(file: string, entries: ManifestEntry[]): ManifestEntry[] {
  if (!existsSync(file)) return entries;

  const fresh = new Set(entries.map((entry) => entry.key));
  const previous = (JSON.parse(readFileSync(file, 'utf8')) as RunManifest).entries;

  return [...previous.filter((entry) => !fresh.has(entry.key)), ...entries];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2), repoRoot);

  if (!options) {
    process.stdout.write(`${USAGE}\n`);

    return;
  }

  const started = performance.now();
  const engine = options.ref ? engineAtRef(repoRoot, options.ref, cacheDir) : currentEngine(repoRoot, options.build);
  const stage = prepareStage(options.assets, cacheDir);
  const jobs = selectJobs(options, engine, stage);

  process.stdout.write(`motion review "${options.label}": ${jobs.length} sheets, engine ${engine.describe}\n`);

  const entries = await renderAll(
    jobs,
    { engine, stage, out: options.out, label: options.label, cacheDir },
    options.jobs
  );
  const manifest: RunManifest = {
    label: options.label,
    engine: engine.describe,
    createdAt: new Date().toISOString(),
    entries: mergeEntries(path.join(options.out, options.label, 'manifest.json'), entries),
  };

  writeFileSync(path.join(options.out, options.label, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  if (options.showcase && existsSync(options.showcase)) copyShowcase(options.showcase, options.out);

  const counts = ['ok', 'skipped', 'failed'].map(
    (status) => `${entries.filter((e) => e.status === status).length} ${status}`
  );
  const seconds = ((performance.now() - started) / 1000).toFixed(1);

  process.stdout.write(`${counts.join(', ')} in ${seconds} s\nindex: ${writeIndex(options.out)}\n`);

  if (entries.some((entry) => entry.status === 'failed')) process.exitCode = 1;
}

await main();
