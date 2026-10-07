// The palette and layer types of the music-library cover scenes (music-covers-data.ts) rendered by
// gen-music-covers.ts. Each layer names a shape helper (music-covers-shapes.ts) and its parameters. `x`/`y`/`s`/`rot` place a local shape (drawn around its own origin); the
// scattered shapes (stars, rain, snow, skylines, hills…) use absolute canvas coordinates instead.
// The title block (Oswald, bottom-left, 40 px margins) covers roughly y > 350, so every focal shape sits
// above it and reads on its own at a 64 px list thumbnail. Scenes live in music-covers-data.ts.

export const PALETTE = {
  ink: '#141316',
  ink2: '#1C1928',
  lav: '#7C83FD',
  lav2: '#A99CFF',
  pink: '#FF8AAE',
  cream: '#F5F3F7',
  yellow: '#FFF685',
  amber: '#FFB86B',
  orange: '#FF9A5A',
  ice: '#BFE3FF',
  sky: '#8FD3FF',
  green: '#6FCF97',
  brown: '#8A5A3C',
  night: '#2A2550',
  dusk: '#4B3F8F',
} as const;

export type ShapeName =
  | 'armchair'
  | 'awning'
  | 'banana'
  | 'bass'
  | 'boombox'
  | 'cassette'
  | 'cat'
  | 'clouds'
  | 'cocktail'
  | 'confetti'
  | 'crane'
  | 'cup'
  | 'discoBall'
  | 'duck'
  | 'eiffel'
  | 'elevator'
  | 'frost'
  | 'glow'
  | 'grandPiano'
  | 'guitar'
  | 'headphones'
  | 'hills'
  | 'infinity'
  | 'kite'
  | 'lamp'
  | 'leaf'
  | 'leaves'
  | 'loopArrows'
  | 'moon'
  | 'mug'
  | 'neonCup'
  | 'notebook'
  | 'notes'
  | 'palm'
  | 'pencil'
  | 'pianoKeys'
  | 'pines'
  | 'pixelNight'
  | 'plant'
  | 'rain'
  | 'rect'
  | 'ripples'
  | 'rooftops'
  | 'rose'
  | 'skyline'
  | 'snow'
  | 'stars'
  | 'stones'
  | 'sun'
  | 'swirl'
  | 'table'
  | 'target'
  | 'tree'
  | 'trumpet'
  | 'turntable'
  | 'vinyl'
  | 'waves'
  | 'window';

export type Param = number | string | boolean | readonly number[] | readonly string[];

export interface Layer {
  shape: ShapeName;
  [key: string]: Param | undefined;
}

export interface CoverSpec {
  id: string;
  title: string;
  artist: string;
  // Sky gradient stops, top to bottom.
  sky: readonly string[];
  layers: readonly Layer[];
}
