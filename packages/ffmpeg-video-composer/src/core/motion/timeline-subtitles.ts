// Timeline event for a subtitle track: captions keep changing from the first cue to the last (cues swap,
// karaoke advances word by word), so the track reads as one continuous text element over that span.
// Its curve is "karaoke": not an easing choice, so pacing rules about curves leave it alone.

import type { Subtitles } from '../../schemas/subtitles.schemas';
import { timedCues } from '../captions/cues';
import { round, textOf, type ElementFrame, type MotionEvent } from './timeline-model';

/** The curve name subtitle events carry. */
export const SUBTITLE_EASE = 'karaoke';

export function subtitleEvents(subtitles: Subtitles | undefined, frame: ElementFrame): MotionEvent[] {
  if (!subtitles) return [];

  const cues = timedCues(subtitles, textOf);

  if (cues.length === 0) return [];

  const start = round(Math.max(0, cues[0].start));
  const end = round(Math.max(...cues.map((cue) => cue.end)));

  return [
    {
      path: `${frame.prefix}.subtitles`,
      element: 'subtitles',
      kind: 'reveal',
      start,
      end: start,
      ease: SUBTITLE_EASE,
      visibleFrom: start,
      visibleUntil: end,
      entrance: false,
      text: true,
      continuous: true,
    },
  ];
}
