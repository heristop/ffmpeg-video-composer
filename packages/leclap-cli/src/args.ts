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

// Pure preprocess applied to process.argv before handing off to the command router. Bare paths /
// unknown first tokens become a `render` invocation; subcommands, flags, and empty argv pass through.
export function rewriteArgv(argv: readonly string[], known: readonly string[]): string[] {
  if (argv.length === 0) return [...argv];

  const first = argv[0];

  if (first.startsWith('-')) return [...argv];

  if (known.includes(first)) return [...argv];

  return ['render', ...argv];
}
