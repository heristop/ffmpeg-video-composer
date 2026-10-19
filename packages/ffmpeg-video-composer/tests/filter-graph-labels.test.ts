import { describe, expect, it } from 'vitest';
import type { FilterGraphChain } from '@/core/types';
import { renderFilterGraph } from '@/editor/utils/filter-graph';
import { stepsAsGraph } from '@/editor/presets/mask-composite';

// The engine's own pad namespace uses a "."; an authored filters[].graph label must never reach it.
const render = (chains: readonly FilterGraphChain[]): string =>
  renderFilterGraph(
    chains,
    (filter) => filter.type,
    () => undefined
  );

describe('graph pad labels', () => {
  it('refuses an authored label in the engine namespace', () => {
    const authored: FilterGraphChain[] = [{ filters: [{ type: 'split' }], outputs: ['sm.mk_o'] }];

    expect(() => render(authored)).toThrow(/invalid pad label "sm\.mk_o"/);
    expect(() => render([{ inputs: ['a.b'], filters: [{ type: 'null' }] }])).toThrow(/invalid pad label/);
  });

  it('keeps ordinary authored labels', () => {
    expect(
      render([
        { filters: [{ type: 'split' }], outputs: ['a_1'] },
        { inputs: ['a_1'], filters: [{ type: 'null' }] },
      ])
    ).toBe('split[a_1];[a_1]null');
  });

  it('lets the engine own sub-graph use the namespace', () => {
    const step = (inputs: string[], outputs: string[]) => ({ inputs, filters: [{ type: 'null' }], outputs });
    const graph = stepsAsGraph([step(['b'], ['sm.o']), step(['sm.o'], ['out'])]);

    expect(render(graph.graph ?? [])).toBe('null[sm.o];[sm.o]null');
  });
});
