import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BACKGROUNDS, FORMATS, type Background, type Format, type ReviewOptions } from './types.ts';

export const USAGE = `pnpm motion:review [options]

  --label <name>        Run column in the index (default: after; "before" with --before)
  --ref <git-ref>       Render with the engine at this ref (exported and built once, cached)
  --before <git-ref>    Shorthand for --ref <git-ref> --label before
  --out <dir>           Output root (default: <tmp>/leclap-motion-review)
  --only <text>         Keep fixtures/templates whose id contains <text> (repeatable, comma-separated)
  --formats <list>      landscape,portrait,square (default: all)
  --backgrounds <list>  footage,dark,light (default: all)
  --effects-only        Skip the bundled templates
  --templates-only      Skip the effect fixtures
  --assets <dir>        Asset bundle (default: apps/leclap-web/public/assets)
  --showcase <dir>      Copy existing PNG sheets into the index as "showcase baseline"
  --jobs <n>            Parallel renders (default: half the CPU count)
  --build               Rebuild the current engine and CLI first
  --help`;

function list<T extends string>(value: string | undefined, all: readonly T[], flag: string): readonly T[] {
  if (value === undefined) return all;

  const items = value.split(',').map((item) => item.trim());
  const unknown = items.filter((item) => !all.includes(item as T));

  if (unknown.length > 0) throw new Error(`--${flag} expects ${all.join(',')}, got "${unknown.join(',')}"`);

  return items as T[];
}

const SPEC = {
  label: { type: 'string' },
  ref: { type: 'string' },
  before: { type: 'string' },
  out: { type: 'string' },
  only: { type: 'string', multiple: true },
  formats: { type: 'string' },
  backgrounds: { type: 'string' },
  'effects-only': { type: 'boolean', default: false },
  'templates-only': { type: 'boolean', default: false },
  assets: { type: 'string' },
  showcase: { type: 'string' },
  jobs: { type: 'string' },
  build: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} as const;

/** Parse argv; returns null when --help was asked. */
export function parseOptions(argv: string[], repoRoot: string): ReviewOptions | null {
  const { values } = parseArgs({ args: argv, options: SPEC, allowPositionals: false });

  if (values.help) return null;

  // `--before <ref>` is shorthand for `--ref <ref> --label before`.
  const ref = values.ref ?? values.before;

  return {
    out: path.resolve(values.out ?? path.join(os.tmpdir(), 'leclap-motion-review')),
    label: values.label ?? (values.before === undefined ? 'after' : 'before'),
    ...(ref !== undefined && { ref }),
    assets: path.resolve(values.assets ?? path.join(repoRoot, 'apps/leclap-web/public/assets')),
    effects: !values['templates-only'],
    templates: !values['effects-only'],
    only: (values.only ?? []).flatMap((item) => item.split(',')).filter(Boolean),
    formats: list<Format>(values.formats, FORMATS, 'formats'),
    backgrounds: list<Background>(values.backgrounds, BACKGROUNDS, 'backgrounds'),
    jobs: Number(values.jobs ?? Math.max(1, Math.floor(os.availableParallelism() / 2))),
    build: values.build,
    ...(values.showcase !== undefined && { showcase: path.resolve(values.showcase) }),
  };
}
