// What a framed film does after a render: pause it, leave it as it is, or play it.
export type FilmPlayback = 'pause' | 'rest' | 'play';

export interface FilmPlaybackState {
  /** Whether enough of the frame is on screen. */
  inView: boolean;
  /** The visitor paused it, it ended, or a requested film is still waiting for its request. */
  held: boolean;
  /** The page set it aside: a film under a dialog, or a dialog's film on its way out. */
  suspended: boolean;
  /** Reduced motion: nothing plays by itself. */
  reduced: boolean;
  /** The visitor asked for this film. */
  requested: boolean;
  /** The tab is in the background. */
  hidden: boolean;
}

export function filmPlayback({ inView, held, suspended, reduced, requested, hidden }: FilmPlaybackState): FilmPlayback {
  if (!inView || held || suspended) return 'pause';

  if ((reduced && !requested) || hidden) return 'rest';

  return 'play';
}
