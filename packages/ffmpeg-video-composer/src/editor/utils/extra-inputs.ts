// Extra `-i` inputs a lowering asks for while it compiles (layout panes, kinetic fill textures). They
// are registered during sugar staging, staged (downloaded / resolved to a path) before the maps are
// built, numbered after every other input of the segment, and appended last to its sources — so no
// existing stream index moves. Sub-graphs name them `input:<key>` (editor/utils/filter-graph.ts).

import type { ExtraInputSource } from '../presets/sugar-context';

interface Entry {
  key: string;
  source: ExtraInputSource;
  /** The staged `-i` fragment (with `-loop 1` for stills), once staged. */
  arg?: string;
}

export class ExtraInputs {
  private entries: Entry[] = [];

  /** Forgets every registration; returns a fresh, empty key → stream-index map for the segment. */
  reset(): Record<string, number> {
    this.entries = [];

    return {};
  }

  get size(): number {
    return this.entries.length;
  }

  /** Registers `source` under `key` (first registration wins) and returns its sub-graph label. */
  register = (key: string, source: ExtraInputSource): string => {
    if (!this.entries.some((entry) => entry.key === key)) this.entries.push({ key, source });

    return `input:${key}`;
  };

  /** Resolves every registered input to its `-i` fragment, in registration order. */
  async stage(resolve: (key: string, source: ExtraInputSource) => Promise<string>): Promise<void> {
    // Stream order is the registration order, not the completion order: each result lands on its entry.
    await Promise.all(
      this.entries.map(async (entry) => {
        entry.arg ??= await resolve(entry.key, entry.source);
      })
    );
  }

  /** Numbers the inputs from `first` (the stream index after every other input) into `indices`. */
  number(first: number, indices: Record<string, number>): void {
    for (const [offset, entry] of this.entries.entries()) indices[entry.key] = first + offset;
  }

  /** Appends the staged fragments to the segment's sources, after everything else (see number()). */
  append(inputsAsset: Record<string, string>): void {
    for (const entry of this.entries) {
      if (!entry.arg) throw new Error(`[ExtraInputs] input "${entry.key}" was registered but never staged`);

      inputsAsset[`extra_${entry.key}`] = entry.arg;
    }
  }
}
