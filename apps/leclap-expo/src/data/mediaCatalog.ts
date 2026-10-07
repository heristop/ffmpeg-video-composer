// Expo media catalog: re-exports shared metadata from core and maps each
// catalog entry to its Metro-bundled asset module (a number resolved at
// compile time by Metro via require()).
//
// Metro requires STATIC require() calls — the path cannot be constructed from
// a variable. Every catalog file therefore gets its own explicit entry below.

import {
  MUSIC_LIBRARY as CORE_MUSIC_LIBRARY,
  BACKGROUND_LIBRARY,
  findMusic,
  findBackground,
  type MediaCredit,
} from '@leclap/creative-kit/media';
import { libraryLabelKey, sampleEntries } from '@leclap/creative-kit/editor';
import { ANIMATION_ASSETS } from './animation-assets.generated';
import { ANIMATION_THUMB_POSTERS } from './animation-thumbs.generated';
import { EMOJI_ASSETS } from './emoji-assets.generated';

export { ANIMATION_ASSETS, EMOJI_ASSETS };

export const MUSIC_LIBRARY: MediaCredit[] = [...CORE_MUSIC_LIBRARY].sort((a, b) => a.title.localeCompare(b.title));
export { BACKGROUND_LIBRARY, findMusic, findBackground, type MediaCredit };

// Metro asset modules. The `number` type comes from Metro's asset resolver:
// require('*.mp3') / require('*.jpg') returns an opaque asset id that
// expo-asset's Asset.fromModule() resolves to a file:// URI at runtime.

// prettier-ignore
export const MUSIC_ASSETS: Record<string, number> = {
  'afterword-zen-lofi.mp3':        require('../../assets/musics/afterword-zen-lofi.mp3'),
  'autumn-day.mp3':                require('../../assets/musics/autumn-day.mp3'),
  'cafe-jazz.mp3':                 require('../../assets/musics/cafe-jazz.mp3'),
  'carefree.mp3':                  require('../../assets/musics/carefree.mp3'),
  'chill-hip-hop.mp3':             require('../../assets/musics/chill-hip-hop.mp3'),
  'chillhop-jazz-coffee-shop.mp3': require('../../assets/musics/chillhop-jazz-coffee-shop.mp3'),
  'chillhop-remain.mp3':           require('../../assets/musics/chillhop-remain.mp3'),
  'dreamy-fall-people.mp3':        require('../../assets/musics/dreamy-fall-people.mp3'),
  'fluffing-a-duck.mp3':           require('../../assets/musics/fluffing-a-duck.mp3'),
  'frosty-shadow-of-winter.mp3':   require('../../assets/musics/frosty-shadow-of-winter.mp3'),
  'indie-rock-dreamy.mp3':         require('../../assets/musics/indie-rock-dreamy.mp3'),
  'local-forecast-elevator.mp3':   require('../../assets/musics/local-forecast-elevator.mp3'),
  'lofi-cafe.mp3':                 require('../../assets/musics/lofi-cafe.mp3'),
  'lofi-chill-audiodollar.mp3':    require('../../assets/musics/lofi-chill-audiodollar.mp3'),
  'lofi-chill.mp3':                require('../../assets/musics/lofi-chill.mp3'),
  'lofi-hip-hop.mp3':              require('../../assets/musics/lofi-hip-hop.mp3'),
  'lofi-jazz-hip-hop.mp3':         require('../../assets/musics/lofi-jazz-hip-hop.mp3'),
  'lofi-jazz-music.mp3':           require('../../assets/musics/lofi-jazz-music.mp3'),
  'lofi-sentimental-jazz.mp3':     require('../../assets/musics/lofi-sentimental-jazz.mp3'),
  'lofi-study.mp3':                require('../../assets/musics/lofi-study.mp3'),
  'monkeys-spinning-monkeys.mp3':  require('../../assets/musics/monkeys-spinning-monkeys.mp3'),
  'oga-lofi-again.mp3':            require('../../assets/musics/oga-lofi-again.mp3'),
  'oga-lofi-loop.mp3':             require('../../assets/musics/oga-lofi-loop.mp3'),
  'once-in-paris.mp3':             require('../../assets/musics/once-in-paris.mp3'),
  'party-dance.mp3':               require('../../assets/musics/party-dance.mp3'),
  'point-being.mp3':               require('../../assets/musics/point-being.mp3'),
  'pop.mp3':                       require('../../assets/musics/pop.mp3'),
  'silence-1-min.mp3':             require('../../assets/musics/silence-1-min.mp3'),
  'since-2-am.mp3':                require('../../assets/musics/since-2-am.mp3'),
  'split-memories.mp3':            require('../../assets/musics/split-memories.mp3'),
  'sunset-stars.mp3':              require('../../assets/musics/sunset-stars.mp3'),
  'the-builder.mp3':               require('../../assets/musics/the-builder.mp3'),
  'tropical-cocktail.mp3':         require('../../assets/musics/tropical-cocktail.mp3'),
  'we-jazz-lofi-soul.mp3':         require('../../assets/musics/we-jazz-lofi-soul.mp3'),
};

// Cover art per music track id (library/covers, staged by copy-core-assets).
// prettier-ignore
export const MUSIC_COVER_ASSETS: Record<string, number> = {
  'afterword-zen-lofi':        require('../../assets/covers/afterword-zen-lofi.webp'),
  'autumn-day':                require('../../assets/covers/autumn-day.webp'),
  'cafe-jazz':                 require('../../assets/covers/cafe-jazz.webp'),
  'carefree':                  require('../../assets/covers/carefree.webp'),
  'chill-hip-hop':             require('../../assets/covers/chill-hip-hop.webp'),
  'chillhop-jazz-coffee-shop': require('../../assets/covers/chillhop-jazz-coffee-shop.webp'),
  'chillhop-remain':           require('../../assets/covers/chillhop-remain.webp'),
  'dreamy-fall-people':        require('../../assets/covers/dreamy-fall-people.webp'),
  'fluffing-a-duck':           require('../../assets/covers/fluffing-a-duck.webp'),
  'frosty-shadow-of-winter':   require('../../assets/covers/frosty-shadow-of-winter.webp'),
  'indie-rock-dreamy':         require('../../assets/covers/indie-rock-dreamy.webp'),
  'local-forecast-elevator':   require('../../assets/covers/local-forecast-elevator.webp'),
  'lofi-cafe':                 require('../../assets/covers/lofi-cafe.webp'),
  'lofi-chill':                require('../../assets/covers/lofi-chill.webp'),
  'lofi-chill-audiodollar':    require('../../assets/covers/lofi-chill-audiodollar.webp'),
  'lofi-hip-hop':              require('../../assets/covers/lofi-hip-hop.webp'),
  'lofi-jazz-hip-hop':         require('../../assets/covers/lofi-jazz-hip-hop.webp'),
  'lofi-jazz-music':           require('../../assets/covers/lofi-jazz-music.webp'),
  'lofi-sentimental-jazz':     require('../../assets/covers/lofi-sentimental-jazz.webp'),
  'lofi-study':                require('../../assets/covers/lofi-study.webp'),
  'monkeys-spinning-monkeys':  require('../../assets/covers/monkeys-spinning-monkeys.webp'),
  'oga-lofi-again':            require('../../assets/covers/oga-lofi-again.webp'),
  'oga-lofi-loop':             require('../../assets/covers/oga-lofi-loop.webp'),
  'once-in-paris':             require('../../assets/covers/once-in-paris.webp'),
  'party-dance':               require('../../assets/covers/party-dance.webp'),
  'point-being':               require('../../assets/covers/point-being.webp'),
  'since-2-am':                require('../../assets/covers/since-2-am.webp'),
  'split-memories':            require('../../assets/covers/split-memories.webp'),
  'sunset-stars':              require('../../assets/covers/sunset-stars.webp'),
  'the-builder':               require('../../assets/covers/the-builder.webp'),
  'tropical-cocktail':         require('../../assets/covers/tropical-cocktail.webp'),
  'we-jazz-lofi-soul':         require('../../assets/covers/we-jazz-lofi-soul.webp'),
};

// prettier-ignore
export const BACKGROUND_ASSETS: Record<string, number> = {
  'autumn-leaves.jpg':   require('../../assets/backgrounds/autumn-leaves.jpg'),
  'cafe-table.jpg':      require('../../assets/backgrounds/cafe-table.jpg'),
  'concrete-lines.jpg':  require('../../assets/backgrounds/concrete-lines.jpg'),
  'desert-dunes.jpg':    require('../../assets/backgrounds/desert-dunes.jpg'),
  'desk-flatlay.jpg':    require('../../assets/backgrounds/desk-flatlay.jpg'),
  'forest-sea.jpg':      require('../../assets/backgrounds/forest-sea.jpg'),
  'golden-hour.jpg':     require('../../assets/backgrounds/golden-hour.jpg'),
  'green-forest.jpg':    require('../../assets/backgrounds/green-forest.jpg'),
  'laptop-desk.jpg':     require('../../assets/backgrounds/laptop-desk.jpg'),
  'milky-way.jpg':       require('../../assets/backgrounds/milky-way.jpg'),
  'monstera-leaves.jpg': require('../../assets/backgrounds/monstera-leaves.jpg'),
  'neon-alley.jpg':      require('../../assets/backgrounds/neon-alley.jpg'),
  'pastel-gradient.jpg': require('../../assets/backgrounds/pastel-gradient.jpg'),
  'pink-sunset.jpg':     require('../../assets/backgrounds/pink-sunset.jpg'),
  'rainy-window.jpg':    require('../../assets/backgrounds/rainy-window.jpg'),
  'rocky-coast.jpg':     require('../../assets/backgrounds/rocky-coast.jpg'),
  'sage-wall.jpg':       require('../../assets/backgrounds/sage-wall.jpg'),
  'snowy-peak.jpg':      require('../../assets/backgrounds/snowy-peak.jpg'),
  'turquoise-sea.jpg':   require('../../assets/backgrounds/turquoise-sea.jpg'),
  'warm-bokeh.jpg':      require('../../assets/backgrounds/warm-bokeh.jpg'),
  'woodshop.jpg':        require('../../assets/backgrounds/woodshop.jpg'),
};

// Template drawtext fonts, keyed by the .ttf filename the core references. Staged into the on-device
// assets dir before compile so the engine resolves them locally (the Google Fonts download can't
// handle multi-word families like "Bebas Neue" derived from a `BebasNeue.ttf` filename).
// prettier-ignore
export const FONT_ASSETS: Record<string, number> = {
  'AbrilFatface.ttf':    require('../../assets/fonts/AbrilFatface.ttf'),
  'Anton.ttf':           require('../../assets/fonts/Anton.ttf'),
  'ArchivoBlack.ttf':    require('../../assets/fonts/ArchivoBlack.ttf'),
  'BebasNeue.ttf':       require('../../assets/fonts/BebasNeue.ttf'),
  'Bungee.ttf':          require('../../assets/fonts/Bungee.ttf'),
  'Lobster.ttf':         require('../../assets/fonts/Lobster.ttf'),
  'NotoSansArabic.ttf':  require('../../assets/fonts/NotoSansArabic.ttf'),
  'NotoSansHebrew.ttf':  require('../../assets/fonts/NotoSansHebrew.ttf'),
  'Oswald.ttf':          require('../../assets/fonts/Oswald.ttf'),
  'Pacifico.ttf':        require('../../assets/fonts/Pacifico.ttf'),
  'PlayfairDisplay.ttf': require('../../assets/fonts/PlayfairDisplay.ttf'),
  'Righteous.ttf':       require('../../assets/fonts/Righteous.ttf'),
  'RobotoMono.ttf':      require('../../assets/fonts/RobotoMono.ttf'),
  'Rubik.ttf':           require('../../assets/fonts/Rubik.ttf'),
};

// Videos a template references by a canonical asset URL (descriptor `options.videoUrl`). Bundled and
// staged into the assets dir before compile so the engine resolves them locally instead of
// downloading the canonical URL (which 404s on-device → an HTML page → AVERROR_INVALIDDATA).
// Only the brand bumpers are bundled; sample clips stay web-only to keep the binary small.
export const VIDEO_ASSETS: Record<string, number> = {
  'leclap_bumper.mp4': require('../../assets/videos/leclap_bumper.mp4'),
  'leclap_bumper_portrait.mp4': require('../../assets/videos/leclap_bumper_portrait.mp4'),
};

// Animation overlays (.apng) bundled for the picker + on-device staging. ANIMATION_ASSETS is the
// generated require map (filename → Metro asset id); the library derives a display label and the
// canonical `/assets/animations/<file>` url that the descriptor stores and the engine resolves
// locally (FilesystemExpoAdapter.resolveLocalAsset + stageBundledAnimations) — same url as the web.
export interface AnimationAsset {
  id: string;
  label: string;
  file: string;
  url: string;
  module: number;
}

const labelFromFile = (file: string): string => {
  const base = file
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  return base.charAt(0).toUpperCase() + base.slice(1);
};

export const ANIMATION_LIBRARY: AnimationAsset[] = Object.entries(ANIMATION_ASSETS).map(([file, module]) => ({
  id: file.replace(/\.[^.]+$/, '').replace(/_/g, '-'),
  label: labelFromFile(file),
  file,
  url: `/assets/animations/${file}`,
  module,
}));

export const findAnimationByUrl = (url: string): AnimationAsset | undefined =>
  ANIMATION_LIBRARY.find((a) => a.url === url);

// The picker's Samples: the legacy overlays it still lists (animation_icons hidden, spec_orbit merged into
// the orbit glint), each with its i18n label key and the still poster cut from a showcase render.
export interface SampleAsset extends AnimationAsset {
  labelKey: string;
  poster?: number;
}

export const SAMPLE_LIBRARY: SampleAsset[] = sampleEntries(Object.keys(ANIMATION_ASSETS).sort()).flatMap((sample) => {
  const asset = ANIMATION_LIBRARY.find((animation) => animation.file === sample.file);

  return asset
    ? [{ ...asset, labelKey: libraryLabelKey(sample.id), poster: ANIMATION_THUMB_POSTERS[`sample:${sample.id}`] }]
    : [];
});

/** The still poster of an engine library entry (fx or graphic), if the thumbnails were generated. */
export const enginePoster = (kind: 'fx' | 'graphic', id: string): number | undefined =>
  ANIMATION_THUMB_POSTERS[`${kind}:${id}`];

export const musicAsset = (id: string): number | undefined => {
  const f = findMusic(id)?.file;

  return f ? MUSIC_ASSETS[f] : undefined;
};

export const backgroundAsset = (id: string): number | undefined => {
  const f = findBackground(id)?.file;

  return f ? BACKGROUND_ASSETS[f] : undefined;
};

/** A music track's cover art (Metro asset id), when the library has one. */
export const musicCover = (id: string): number | undefined => MUSIC_COVER_ASSETS[id];
