// The umbrella subcommands. The first arg is rewritten to `render` when it isn't one of these (and
// isn't a flag) so `leclap my-template.json` keeps working as a shorthand for `leclap render …`.
export const KNOWN_COMMANDS = [
  'render',
  'init',
  'diagnose',
  'validate',
  'samples',
  'verify',
  'style',
  'studio',
  'beats',
  'snapshot',
  'compare',
  'timeline',
  'resolve',
] as const;

const STUDIO_SUBCOMMANDS = new Set(['open', 'status', 'pass']);
// `studio open` flags that take a value (`--base <url>`): the next token is that value, not a command.
export const STUDIO_OPEN_VALUE_FLAGS = new Set(['base']);

function takesValue(flag: string): boolean {
  return !flag.includes('=') && STUDIO_OPEN_VALUE_FLAGS.has(flag.replace(/^-{1,2}/, ''));
}

// Index of the first positional after `studio` (citty's own scan: flag values are skipped, `--` ends
// it), or -1 when there is none.
function firstPositional(argv: readonly string[]): number {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') return -1;

    if (!arg.startsWith('-')) return i;

    if (takesValue(arg)) i++;
  }

  return -1;
}

// `leclap studio [flags] <template>` is shorthand for `leclap studio open [flags] <template>`; the gate
// subcommands, `--help` and a bare `studio` pass through.
function rewriteStudio(argv: readonly string[]): string[] {
  const index = firstPositional(argv);

  if (index === -1 || STUDIO_SUBCOMMANDS.has(argv[index])) return [...argv];

  return ['studio', 'open', ...argv.slice(1)];
}

// Pure preprocess applied to process.argv before handing off to the command router. Bare paths /
// unknown first tokens become a `render` invocation; subcommands, flags, and empty argv pass through.
export function rewriteArgv(argv: readonly string[], known: readonly string[]): string[] {
  if (argv.length === 0) return [...argv];

  const first = argv[0];

  if (first.startsWith('-')) return [...argv];

  if (first === 'studio') return rewriteStudio(argv);

  if (known.includes(first)) return [...argv];

  return ['render', ...argv];
}
