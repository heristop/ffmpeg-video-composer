// The per-track scenes of the music-library covers rendered by gen-music-covers.ts: a sky gradient plus a stack of
// layers drawn bottom-up on a 512×512 canvas, each naming a shape helper and its parameters (see
// music-covers-types.ts). The title block covers roughly y > 350, so each focal shape sits above it and reads on
// its own at a 64 px list thumbnail. Ids, titles and artists match src/media.ts.
import { LIBRARY_COVERS } from './music-covers-data-library.ts';
import { PALETTE as C, type CoverSpec } from './music-covers-types.ts';

const LOFI_COVERS: readonly CoverSpec[] = [
  {
    id: 'once-in-paris',
    title: 'Once In Paris',
    artist: 'Pumpupthemind',
    sky: [C.night, C.dusk, C.lav2, C.pink],
    layers: [
      { shape: 'stars', count: 40, bottom: 220 },
      { shape: 'moon', x: 380, y: 92, r: 34, phase: 0.55, color: C.cream },
      { shape: 'eiffel', x: 236, y: 330, s: 1.3, color: C.ink2 },
      { shape: 'rooftops', base: 410, color: '#2B2346', roof: '#3A2F5E', lit: C.amber },
    ],
  },
  {
    id: 'split-memories',
    title: 'Split Memories',
    artist: 'IdoBerg',
    sky: ['#3B3270', C.lav, C.pink],
    layers: [
      { shape: 'glow', x: 256, y: 120, r: 200, color: C.amber, opacity: 0.45 },
      { shape: 'stars', count: 10, bottom: 140, color: C.cream },
      { shape: 'window', wx: 86, wy: 30, ww: 340, wh: 280, wall: '#2A2244', frame: C.cream, bars: 'cross', sill: true },
      { shape: 'mug', x: 200, y: 317, s: 0.95, color: C.pink, band: C.cream, steam: C.cream },
      { shape: 'mug', x: 318, y: 317, s: 0.95, color: C.lav2, band: C.cream, steam: C.cream, flip: true },
    ],
  },
  {
    id: 'sunset-stars',
    title: 'Sunset Stars',
    artist: 'IdoBerg',
    sky: [C.night, C.lav, C.pink, C.orange, C.amber],
    layers: [
      { shape: 'stars', count: 30, bottom: 150, sparkles: 4 },
      { shape: 'sun', x: 256, y: 268, r: 82, color: C.yellow, halo: C.amber },
      { shape: 'hills', base: 270, amp: 26, color: '#C25E8E', seed: 3 },
      { shape: 'hills', base: 315, amp: 22, color: '#6B4A9E', seed: 7 },
      { shape: 'hills', base: 360, amp: 18, color: C.ink2, seed: 11 },
    ],
  },
  {
    id: 'frosty-shadow-of-winter',
    title: 'Frosty Shadow of Winter',
    artist: 'ShidenBeatsMusic',
    sky: ['#1E2A55', '#3D5A99', C.ice],
    layers: [
      { shape: 'stars', count: 18, bottom: 140, color: C.cream },
      { shape: 'pines', base: 300, count: 7, color: '#22305E', minH: 90, maxH: 170 },
      { shape: 'pines', base: 320, count: 6, color: C.ink2, minH: 70, maxH: 130, seed: 5 },
      { shape: 'snow', count: 60, bottom: 320, color: C.cream },
      { shape: 'frost', wx: 70, wy: 28, ww: 372, wh: 272, color: C.cream },
      { shape: 'window', wx: 70, wy: 28, ww: 372, wh: 272, wall: '#5E6FA8', frame: C.cream, bars: 'cross', sill: true },
    ],
  },
  {
    id: 'lofi-jazz-hip-hop',
    title: 'Lofi Jazz Hip Hop',
    artist: 'VibeHorn',
    sky: [C.yellow, '#FFD3A8', C.pink],
    layers: [
      { shape: 'glow', x: 256, y: 180, r: 190, color: C.cream, opacity: 0.6 },
      { shape: 'trumpet', x: 262, y: 186, s: 1.25, rot: -18, color: '#E0A33A', shade: '#B9772A' },
      { shape: 'notes', points: [96, 92, 400, 70, 430, 250, 120, 270], color: C.lav, size: 1.2 },
    ],
  },
  {
    id: 'lofi-jazz-music',
    title: 'Lofi Jazz Music',
    artist: 'lofidreams',
    sky: [C.ink, C.ink2, C.night],
    layers: [
      { shape: 'stars', count: 26, bottom: 160 },
      { shape: 'glow', x: 240, y: 200, r: 210, color: C.lav, opacity: 0.35 },
      { shape: 'turntable', x: 256, y: 196, s: 1.05, base: '#2E2758', label: C.pink },
    ],
  },
  {
    id: 'lofi-cafe',
    title: 'Lofi Cafe',
    artist: 'lofidreams',
    sky: ['#5A3A5E', '#B0646A', C.amber],
    layers: [
      { shape: 'glow', x: 256, y: 130, r: 220, color: C.yellow, opacity: 0.4 },
      { shape: 'table', x: 256, y: 300, color: C.ink2 },
      { shape: 'cup', x: 256, y: 282, s: 1.35, color: C.cream, coffee: C.brown, steam: C.cream, accent: C.pink },
    ],
  },
  {
    id: 'we-jazz-lofi-soul',
    title: 'WE JAZZ Lofi Soul',
    artist: 'jumpingbunny',
    sky: ['#3A2142', '#7A3A50', '#C0645A'],
    layers: [
      { shape: 'glow', x: 256, y: 180, r: 210, color: C.amber, opacity: 0.55 },
      { shape: 'glow', x: 256, y: 180, r: 120, color: C.pink, opacity: 0.35 },
      { shape: 'bass', x: 256, y: 238, s: 0.78, rot: 12, color: '#E8944A', shade: '#8E4B26' },
    ],
  },
  {
    id: 'lofi-chill-audiodollar',
    title: 'Lo-Fi Chill',
    artist: 'AudioDollar',
    sky: ['#2B2550', C.dusk, C.lav],
    layers: [
      { shape: 'rect', x: 0, y: 300, w: 512, h: 212, color: '#3A2F66' },
      { shape: 'lamp', x: 168, y: 302, s: 1.15, color: C.pink, light: C.yellow },
      { shape: 'plant', x: 380, y: 302, s: 1, pot: C.cream, leaf: C.green },
      { shape: 'headphones', x: 300, y: 290, s: 0.42, color: C.lav2, cup: C.ink2 },
    ],
  },
  {
    id: 'chillhop-remain',
    title: 'Remain',
    artist: 'Ornave',
    sky: [C.ink, C.night],
    layers: [
      { shape: 'rect', x: 40, y: 24, w: 432, h: 290, color: '#241F45' },
      { shape: 'stars', count: 14, top: 30, bottom: 140, left: 44, right: 468 },
      {
        shape: 'skyline',
        base: 314,
        left: 40,
        right: 472,
        minH: 60,
        maxH: 190,
        color: '#151227',
        light: C.amber,
        lit: 0.35,
      },
      { shape: 'window', wx: 40, wy: 24, ww: 432, wh: 290, wall: C.ink2, frame: '#3A3466', bars: 'grid' },
      { shape: 'glow', x: 160, y: 320, r: 160, color: C.lav, opacity: 0.25 },
      { shape: 'armchair', x: 168, y: 340, s: 1.05, color: C.pink, shade: '#D8668B' },
    ],
  },
  {
    id: 'dreamy-fall-people',
    title: 'Dreamy Fall People',
    artist: 'Diamond_Tunes',
    sky: [C.lav2, C.pink, C.amber],
    layers: [
      { shape: 'pianoKeys', x: 24, y: 210, w: 470, h: 120, n: 11, rot: -9, white: C.cream, black: C.ink2 },
      { shape: 'leaves', count: 16, bottom: 300, colors: [C.orange, '#E2603F', C.amber, C.pink] },
    ],
  },
  {
    id: 'chillhop-jazz-coffee-shop',
    title: 'Chillhop Jazz Coffee Shop',
    artist: 'alex-morgan',
    sky: ['#0F1530', '#1F2350', '#3B2F66'],
    layers: [
      { shape: 'glow', x: 256, y: 160, r: 200, color: C.pink, opacity: 0.28 },
      { shape: 'neonCup', x: 256, y: 170, s: 1.1, color: C.pink, steam: C.lav2 },
      { shape: 'rain', count: 70, bottom: 340, color: C.ice },
      {
        shape: 'window',
        wx: 50,
        wy: 26,
        ww: 412,
        wh: 272,
        wall: C.ink2,
        frame: '#2E2A50',
        bars: 'vertical',
        sill: true,
      },
    ],
  },
  {
    id: 'lofi-study',
    title: 'Lofi Study',
    artist: 'The_Mountain',
    sky: [C.lav2, C.lav],
    layers: [
      { shape: 'notebook', x: 220, y: 170, s: 1.05, rot: -6, page: C.cream, line: C.lav2, cover: C.ink2 },
      { shape: 'pencil', x: 250, y: 172, s: 1, rot: 32, color: C.yellow },
      { shape: 'cassette', x: 400, y: 280, s: 0.6, rot: 14, color: C.pink, label: C.cream },
    ],
  },
  {
    id: 'afterword-zen-lofi',
    title: 'Afterword',
    artist: 'Turning_Pages',
    sky: [C.cream, '#DCD8F2', C.lav2],
    layers: [
      { shape: 'ripples', x: 256, y: 290, rings: 5, color: C.lav },
      { shape: 'stones', x: 256, y: 280, s: 1, colors: [C.ink2, '#3A3466', C.lav, C.pink] },
      { shape: 'leaf', x: 390, y: 310, s: 1.4, rot: 30, color: C.green },
    ],
  },
  {
    id: 'chill-hip-hop',
    title: 'Chill Hip Hop',
    artist: 'BombinSound',
    sky: [C.pink, '#FFB3C8', C.yellow],
    layers: [
      { shape: 'glow', x: 256, y: 190, r: 190, color: C.cream, opacity: 0.5 },
      { shape: 'boombox', x: 256, y: 196, s: 1.25, color: C.lav, panel: C.ink2, bars: C.yellow },
    ],
  },
  {
    id: 'oga-lofi-again',
    title: 'Lofi Again',
    artist: 'omfgdude',
    sky: ['#1E1A3A', C.night, C.dusk],
    layers: [
      { shape: 'glow', x: 256, y: 180, r: 180, color: C.pink, opacity: 0.3 },
      { shape: 'loopArrows', x: 256, y: 180, s: 1.15, color: C.lav2, accent: C.pink, play: C.yellow },
    ],
  },
  {
    id: 'oga-lofi-loop',
    title: 'Lofi Hip Hop Loop',
    artist: 'omfgdude',
    sky: [C.lav, C.lav2, C.pink],
    layers: [
      { shape: 'infinity', x: 256, y: 186, s: 1.3, from: C.ink2, to: C.dusk },
      { shape: 'headphones', x: 256, y: 168, s: 0.62, color: C.yellow, cup: C.ink2 },
    ],
  },
  {
    id: 'since-2-am',
    title: 'Since 2 A.M.',
    artist: 'TAD',
    sky: ['#0E0C24', '#1B1745', '#2C2466'],
    layers: [{ shape: 'pixelNight', moon: C.yellow, frame: C.lav, digits: C.pink, star: C.cream }],
  },
];

export const COVERS: readonly CoverSpec[] = [...LOFI_COVERS, ...LIBRARY_COVERS];
