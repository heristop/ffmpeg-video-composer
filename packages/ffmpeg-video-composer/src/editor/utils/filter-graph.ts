// Renders an engine-internal sub-graph (Filter.graph) into filtergraph text, so a lowering that branches
// — a text mask merged into a gradient, panes composited into a split screen — can still sit in a
// section's linear filter list. The fragment is spliced where the filter stood:
//
//   …,scale=…,<chain0>[a];<source chain>[b];[a][b]overlay=0:0,<next filter>…
//
// FFmpeg resolves the labels across the whole graph, so this works in a `-vf` chain (sources only: no
// `input:` labels) as well as inside a `-filter_complex` map. Each filter is rendered by the caller
// (FilterManager.addFilter: compat, formatting, escaping); labels are validated here, never trusted.

import type { Filter, FilterGraphChain } from '@/core/types';

const PAD = /^[A-Za-z0-9_]+$/;
// The engine's own sub-graphs (engineGraph) may also use a "." in a label: a namespace no authored name can reach.
const ENGINE_PAD = /^[A-Za-z0-9_.]+$/;
const ENGINE_GRAPHS = new WeakSet<readonly FilterGraphChain[]>();

/** Marks chains the engine built itself, so their labels may use the "." namespace; authored graphs never are. */
export function engineGraph(chains: FilterGraphChain[]): FilterGraphChain[] {
  ENGINE_GRAPHS.add(chains);

  return chains;
}
const INPUT = /^input:([A-Za-z0-9_]+)$/;

/** Resolves a chain label to its filtergraph pad: `input:<key>` → `<index>:v`, else the pad name. */
function padFor(label: string, inputIndex: (key: string) => number | undefined, engine: boolean): string {
  const input = INPUT.exec(label);

  if (input) {
    const index = inputIndex(input[1]);

    if (index === undefined) throw new Error(`[FilterGraph] unregistered input "${input[1]}"`);

    return `${index}:v`;
  }

  if (!(engine ? ENGINE_PAD : PAD).test(label)) throw new Error(`[FilterGraph] invalid pad label "${label}"`);

  return label;
}

/** True when the fragment reads an extra `-i` input, which only a `-filter_complex` graph can do. */
export function graphReadsInputs(chains: readonly FilterGraphChain[]): boolean {
  return chains.some((chain) => (chain.inputs ?? []).some((label) => INPUT.test(label)));
}

/** The filtergraph text of a fragment, chains joined by `;`. */
export function renderFilterGraph(
  chains: readonly FilterGraphChain[],
  renderFilter: (filter: Filter) => string,
  inputIndex: (key: string) => number | undefined
): string {
  const engine = ENGINE_GRAPHS.has(chains);

  return chains
    .map((chain) => {
      const inputs = (chain.inputs ?? []).map((label) => `[${padFor(label, inputIndex, engine)}]`).join('');
      const outputs = (chain.outputs ?? []).map((label) => `[${padFor(label, inputIndex, engine)}]`).join('');

      return `${inputs}${chain.filters.map(renderFilter).join(',')}${outputs}`;
    })
    .join(';');
}
