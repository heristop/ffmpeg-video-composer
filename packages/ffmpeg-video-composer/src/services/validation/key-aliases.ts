import { nearest, normalizeToken } from './suggest';

// Names authors (and language models) reach for that are not a small typo away from the real key.
// Keyed by the normalized wrong name; each value lists real schema keys in priority order, and only a
// target that is actually allowed at the offending path is ever suggested — so "start" becomes
// "delay" inside a reveal but stays "start" on a whole-video animation, where it is a real key.
const KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  colour: ['color', 'fontcolor', 'backgroundColor'],
  textcolor: ['color', 'fontcolor'],
  fontcolor: ['color'],
  color: ['fontcolor', 'backgroundColor'],
  bg: ['backgroundColor'],
  bgcolor: ['backgroundColor', 'boxColor'],
  background: ['backgroundColor'],
  backgroundcolour: ['backgroundColor'],
  fontsize: ['size'],
  textsize: ['size', 'fontsize'],
  size: ['fontsize'],
  font: ['family', 'fontfile'],
  fontfamily: ['family', 'font'],
  fontname: ['family', 'font'],
  fontweight: ['weight'],
  ease: ['easing', 'curve'],
  easingcurve: ['easing', 'ease', 'curve'],
  curve: ['easing', 'ease'],
  easing: ['ease', 'curve'],
  length: ['duration'],
  time: ['duration'],
  seconds: ['duration'],
  start: ['delay', 'at', 'after'],
  starttime: ['start', 'delay', 'at'],
  begin: ['delay', 'start', 'at'],
  offset: ['delay', 'start', 'at'],
  delay: ['start', 'at', 'after'],
  end: ['until'],
  stop: ['until'],
  animation: ['reveal', 'motion'],
  entrance: ['reveal'],
  enter: ['reveal'],
  intro: ['reveal'],
  exitanimation: ['exit'],
  outro: ['exit'],
  zoom: ['intensity', 'scale'],
  strength: ['intensity'],
  amount: ['intensity'],
  transparency: ['opacity', 'alpha'],
  alpha: ['opacity'],
  opacity: ['alpha', 'boxOpacity'],
  src: ['url', 'videoUrl', 'pictureUrl'],
  source: ['url', 'videoUrl', 'pictureUrl'],
  path: ['url'],
  file: ['url', 'fontfile'],
  uri: ['url'],
  image: ['url', 'pictureUrl'],
  rotate: ['rotation', 'angle'],
  degrees: ['angle', 'rotation'],
  volume: ['musicVolume', 'sourceVolume'],
  mute: ['muteSection'],
  fadein: ['in'],
  fadeout: ['out'],
  effects: ['motion'],
  animations: ['motion', 'inputs'],
};

function aliasTarget(key: string, allowed: readonly string[]): string | undefined {
  const targets = KEY_ALIASES[normalizeToken(key)] ?? [];

  return targets.find((target) => allowed.includes(target));
}

// The allowed key an unknown `key` most likely meant: a normalized-equal key first ("font-size" →
// "fontsize"), then the alias table, then the nearest typo within the edit-distance budget.
export function nearestKey(key: string, allowed: readonly string[]): string | undefined {
  const normalized = normalizeToken(key);
  const exact = allowed.find((candidate) => normalizeToken(candidate) === normalized);

  return exact ?? aliasTarget(key, allowed) ?? nearest(key, allowed);
}
