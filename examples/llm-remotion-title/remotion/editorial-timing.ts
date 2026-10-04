export type EditorialProps = {
  headline: string;
  kicker: string;
  mode: 'masked-rise' | 'word-stagger' | 'highlight' | 'blur-rise' | 'split-slide' | 'elastic-stagger';
  accent: 'lavender' | 'mint' | 'orange';
  entranceDurationFrames: number;
  staggerFrames: number;
  travelPx: number;
  highlightWord: number;
};

export const editorialDefaults: EditorialProps = {
  headline: 'Make your next story',
  kicker: 'CREATIVE DIRECTION',
  mode: 'masked-rise',
  accent: 'orange',
  entranceDurationFrames: 18,
  staggerFrames: 3,
  travelPx: 56,
  highlightWord: 0,
};

/** Preserve all copy while bounding the last item's entrance to 15 × 8 + 40 = 160 frames. */
export function editorialWords(headline: string): string[] {
  const words = headline.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) throw new Error('Editorial headline must contain a non-whitespace character.');

  return words.length > 16 ? [...words.slice(0, 15), words.slice(15).join(' ')] : words;
}

function progress(frame: number, start: number, duration: number): number {
  const linear = Math.min(1, Math.max(0, (frame - start) / duration));

  return 1 - Math.pow(1 - linear, 3);
}

/** Pure frame-time sampling; geometry never changes during the highlight sweep. */
export function editorialTiming(frame: number, index: number, props: EditorialProps, durationInFrames = 300) {
  const staggered = ['word-stagger', 'blur-rise', 'split-slide', 'elastic-stagger'].includes(props.mode);
  const start = staggered ? index * props.staggerFrames : 0;
  const entrance = progress(frame, start, props.entranceDurationFrames);
  const linear = Math.min(1, Math.max(0, (frame - start) / props.entranceDurationFrames));
  const elastic = linear * (1 + (linear - 1) * (2.70158 * (linear - 1) - 1));
  const movement = props.mode === 'elastic-stagger' ? elastic : entrance;
  const highlightProgress =
    props.mode === 'highlight' ? progress(frame, props.entranceDurationFrames, props.entranceDurationFrames) : 1;
  const sceneOpacity = Math.min(1, Math.max(0, (durationInFrames - 1 - frame) / 12));

  return {
    progress: entrance,
    opacity: Math.min(1, Math.max(0, movement)),
    translateX:
      props.mode === 'split-slide' && entrance < 1 ? (index % 2 === 0 ? -1 : 1) * props.travelPx * (1 - entrance) : 0,
    translateY: props.mode === 'highlight' || props.mode === 'split-slide' ? 0 : props.travelPx * (1 - movement),
    scale: editorialScale(props.mode, movement),
    blurPx: props.mode === 'blur-rise' ? 8 * (1 - entrance) : 0,
    highlightProgress,
    sceneOpacity,
  };
}

function editorialScale(mode: EditorialProps['mode'], movement: number): number {
  if (mode === 'word-stagger') return 0.96 + 0.04 * movement;

  if (mode === 'elastic-stagger') return 0.92 + 0.08 * movement;

  return 1;
}

/** Bounded search over a measured, unanimated layout; fitting never samples frame-time transforms. */
export function fitEditorialFontSize(fits: (fontSize: number) => boolean): number {
  let low = 32;
  let high = 104;

  if (!fits(low)) throw new Error('Editorial copy cannot fit inside the safe area at the minimum font size.');

  if (fits(high)) return high;

  for (let iteration = 0; iteration < 12; iteration++) {
    const candidate = (low + high) / 2;

    if (fits(candidate)) {
      low = candidate;
      continue;
    }
    high = candidate;
  }

  return Math.floor(low * 100) / 100;
}
