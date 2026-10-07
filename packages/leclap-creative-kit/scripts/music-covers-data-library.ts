// Cover scenes of the tracks kept from the earlier music library (see music-covers-data.ts).
import { PALETTE as C, type CoverSpec } from './music-covers-types.ts';

export const LIBRARY_COVERS: readonly CoverSpec[] = [
  {
    id: 'cafe-jazz',
    title: 'Peaceful Cafe Jazz',
    artist: 'alex-morgan',
    sky: ['#FFE2B8', C.amber, '#E98A6A'],
    layers: [
      { shape: 'glow', x: 256, y: 220, r: 200, color: C.yellow, opacity: 0.45 },
      { shape: 'awning', stripes: [C.pink, C.cream], depth: 74 },
      { shape: 'grandPiano', x: 262, y: 322, s: 1.15, color: C.ink2, keys: C.cream },
      { shape: 'notes', points: [120, 140, 400, 130], color: C.lav, size: 1 },
    ],
  },
  {
    id: 'autumn-day',
    title: 'Autumn Day',
    artist: 'Kevin MacLeod',
    sky: ['#F7C9A8', C.amber, '#E77F5A'],
    layers: [
      { shape: 'sun', x: 380, y: 250, r: 54, color: C.cream, halo: C.yellow },
      { shape: 'hills', base: 320, amp: 12, color: '#B4567A', seed: 4 },
      { shape: 'tree', x: 200, y: 322, s: 1, trunk: C.ink2, colors: [C.orange, '#E2603F', C.amber, C.pink] },
      { shape: 'leaves', count: 9, top: 120, bottom: 310, colors: [C.amber, C.orange, C.pink] },
    ],
  },
  {
    id: 'carefree',
    title: 'Carefree',
    artist: 'Kevin MacLeod',
    sky: ['#6FB6F2', C.sky, '#D9F0FF'],
    layers: [
      { shape: 'clouds', x: 110, y: 90, s: 1, color: C.cream },
      { shape: 'clouds', x: 420, y: 260, s: 0.8, color: C.cream },
      { shape: 'kite', x: 300, y: 150, s: 1.2, rot: 12, a: C.pink, b: C.lav, tail: C.yellow },
    ],
  },
  {
    id: 'fluffing-a-duck',
    title: 'Fluffing a Duck',
    artist: 'Kevin MacLeod',
    sky: [C.lav2, '#C9C2FF', C.ice],
    layers: [
      { shape: 'duck', x: 250, y: 236, s: 1.45, color: '#FFD84D', light: C.yellow, beak: C.orange },
      { shape: 'waves', y: 262, amp: 10, color: C.lav, rows: 3 },
    ],
  },
  {
    id: 'indie-rock-dreamy',
    title: 'Indie Rock Dreamy',
    artist: 'alex-morgan',
    sky: [C.ink, C.night, '#5B3C8C'],
    layers: [
      { shape: 'stars', count: 50, bottom: 330, sparkles: 5 },
      { shape: 'glow', x: 256, y: 200, r: 200, color: C.pink, opacity: 0.35 },
      { shape: 'guitar', x: 256, y: 210, s: 0.92, rot: 38, color: C.pink, guard: C.cream, neck: '#D9A066' },
    ],
  },
  {
    id: 'local-forecast-elevator',
    title: 'Local Forecast - Elevator',
    artist: 'Kevin MacLeod',
    sky: ['#3A3466', C.dusk, C.lav],
    layers: [{ shape: 'elevator', x: 256, y: 34, s: 0.88, door: C.lav2, brass: C.amber, button: C.yellow }],
  },
  {
    id: 'lofi-chill',
    title: 'Lo-fi Chill',
    artist: 'AtlasAudio',
    sky: ['#1E2246', '#34407A', '#5B6BB0'],
    layers: [
      { shape: 'glow', x: 380, y: 90, r: 120, color: C.lav2, opacity: 0.4 },
      { shape: 'rain', count: 80, bottom: 320, color: C.ice },
      { shape: 'window', wx: 56, wy: 24, ww: 400, wh: 296, wall: C.lav, frame: C.cream, bars: 'cross', sill: true },
      { shape: 'cat', x: 186, y: 322, s: 1.2, color: C.ink },
    ],
  },
  {
    id: 'lofi-hip-hop',
    title: 'Lo-fi Hip-Hop',
    artist: 'leberch',
    sky: [C.night, C.lav, C.pink],
    layers: [
      { shape: 'skyline', base: 380, minH: 70, maxH: 210, color: C.ink2, light: C.yellow, lit: 0.3 },
      { shape: 'headphones', x: 256, y: 160, s: 1.25, color: C.cream, cup: C.pink },
    ],
  },
  {
    id: 'lofi-sentimental-jazz',
    title: 'Lo-fi Sentimental Jazz',
    artist: 'Sonican',
    sky: ['#2B1B33', '#4A2A4F', '#7A3E62'],
    layers: [
      { shape: 'vinyl', x: 300, y: 180, s: 1.55, label: C.lav2 },
      { shape: 'rose', x: 190, y: 170, s: 1, rot: -28, petal: '#E5476E', light: C.pink, stem: C.green },
    ],
  },
  {
    id: 'monkeys-spinning-monkeys',
    title: 'Monkeys Spinning Monkeys',
    artist: 'Kevin MacLeod',
    sky: [C.green, '#B6E8A0', C.yellow],
    layers: [
      { shape: 'swirl', x: 256, y: 180, s: 1, color: C.lav, accent: C.pink },
      { shape: 'banana', x: 256, y: 182, s: 1.25, rot: -18, color: C.yellow, edge: '#E8B92E' },
    ],
  },
  {
    id: 'party-dance',
    title: 'Party Dance',
    artist: 'prettyjohn1',
    sky: [C.ink2, '#3A1F56', '#8E3C7A'],
    layers: [
      { shape: 'confetti', count: 60, bottom: 360, colors: [C.pink, C.yellow, C.lav2, C.sky] },
      { shape: 'discoBall', x: 256, y: 170, s: 1.15, color: C.lav2, shade: C.dusk, beam: C.pink },
    ],
  },
  {
    id: 'point-being',
    title: 'Point Being',
    artist: 'Go By Ocean / Ryan McCaffrey',
    sky: [C.cream, '#E8E4F7'],
    layers: [{ shape: 'target', x: 300, y: 160, s: 1, ring: C.lav, dot: C.pink, arrow: C.ink2, accent: C.yellow }],
  },
  {
    id: 'the-builder',
    title: 'The Builder',
    artist: 'Kevin MacLeod',
    sky: [C.lav, C.lav2, '#FFC2A8'],
    layers: [
      { shape: 'sun', x: 410, y: 110, r: 40, color: C.cream, halo: C.pink },
      { shape: 'crane', x: 150, y: 340, s: 1, color: C.yellow, line: C.ink2, blocks: [C.pink, C.lav, C.cream] },
    ],
  },
  {
    id: 'tropical-cocktail',
    title: 'Tropical Cocktail',
    artist: 'The_Mountain',
    sky: [C.lav, C.pink, C.orange, C.yellow],
    layers: [
      { shape: 'sun', x: 300, y: 250, r: 90, color: C.yellow, halo: C.orange },
      { shape: 'waves', y: 262, amp: 6, color: '#6B5BC9', rows: 4, fill: true },
      { shape: 'palm', x: 108, y: 360, s: 1.15, trunk: '#5A3A4E', frond: C.ink2 },
      { shape: 'cocktail', x: 330, y: 330, s: 1.15, glass: C.cream, drink: C.pink, umbrella: C.lav },
    ],
  },
];
