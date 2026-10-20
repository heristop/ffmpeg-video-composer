// The program monitor's sound: the template's music track under the playhead, at the level the render
// would mix it (template volume, per-scene overrides and fades), started and stopped with the transport
// and re-synced when it drifts from the clock. A track preview in the music panel takes over the sound,
// so starting one pauses the program; starting the program stops any preview.
import { useEffect, useRef } from 'react';
import type { EditorState } from '../templateEditorModel';
import { onPreviewStart, stopPreview } from '../editor/music-preview';
import { musicGainAt, musicTimeAt, programMusicTrack } from './program-music.logic';
import type { Segment } from './program-timeline.logic';
import type { ProgramClock } from './use-program-clock';

// How far the audio may wander from the clock before it is pulled back, in seconds. Tighter than this
// and the element seeks (and clicks) on every tick on a loaded machine.
const DRIFT_TOLERANCE = 0.25;

export function useProgramMusic(state: EditorState, clock: ProgramClock, timeline: Segment[]): void {
  const url = programMusicTrack(state.sections)?.url;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mixRef = useRef({ state, timeline });

  useEffect(() => {
    mixRef.current = { state, timeline };
  }, [state, timeline]);

  useEffect(() => {
    const audio = url ? new Audio(url) : null;

    if (audio) {
      audio.preload = 'auto';
      audio.preservesPitch = true;
    }

    audioRef.current = audio;

    return () => {
      audio?.pause();
      audioRef.current = null;
    };
  }, [url]);

  // Start/stop with the transport. Reverse shuttle plays silent, like a deck scrubbing backwards.
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) return;

    if (!clock.playing || clock.rate <= 0) {
      audio.pause();

      return;
    }

    stopPreview();
    audio.playbackRate = clock.rate;
    audio.currentTime = musicTimeAt(clock.current(), audio.duration);
    audio.play().catch(() => {
      // Autoplay refusals and aborted loads leave the picture playing silent; nothing to show.
    });
  }, [clock, clock.playing, clock.rate, url]);

  // Level and drift, every clock tick.
  useEffect(
    () =>
      clock.subscribe((t) => {
        const audio = audioRef.current;

        if (!audio) return;

        const { state: current, timeline: line } = mixRef.current;
        audio.volume = musicGainAt(line, current.sections, current.audio, t);

        if (audio.paused) return;

        const expected = musicTimeAt(t, audio.duration);

        if (Math.abs(audio.currentTime - expected) > DRIFT_TOLERANCE) audio.currentTime = expected;
      }),
    [clock]
  );

  useEffect(
    () =>
      onPreviewStart(() => {
        clock.pause();
      }),
    [clock]
  );
}
