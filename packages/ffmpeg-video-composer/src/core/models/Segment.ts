import { injectable } from 'tsyringe';
import type { Section } from '../types';
import type { FontRef } from '../fonts';

// One font the segment needs staged before it renders. `file` is the name it is staged under (and
// the dedupe key); `ref` is present only for a font named by family, and carries the exact family /
// weight / style to request. The ref travels alongside the filename rather than being encoded into
// it, because decoding a slug back into a family name is lossy ("Press Start 2P").
export type FontRequest = { file: string; ref?: FontRef };

@injectable()
class Segment {
  public currentSection?: Section;

  public filtersList: string[] = [];
  public filtersMapList: string[] = [];
  public mapsList: string[] = [];
  public assetsDir = '';
  public fontsDir = '';
  public tempFonts: FontRequest[] = [];
  public lutsDir = '';
  public tempLuts: string[] = [];
  public panelsDir = '';
  public inputsAsset: string[] = [];
  public inputsMapCount = 0;
  // Stream index of each extra `-i` a lowering registered (layout panes, fill textures), by key; read by
  // `input:<key>` labels in engine sub-graphs (editor/utils/filter-graph.ts).
  public extraInputs: Record<string, number> = {};
}

export default Segment;
