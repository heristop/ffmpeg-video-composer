// State for one "Match a reference" session: the chosen files, the analysis run (cancellable) and
// its result. The analyzer module loads lazily on the first run.
import { useEffect, useRef, useState } from 'react';
import type { ReferenceStyle } from '@/infrastructure/style/analyze-reference';

export type ReferenceRun =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ready'; style: ReferenceStyle }
  | { kind: 'error'; message: string };

export function useReferenceStyle() {
  const [image, setImage] = useState<File | null>(null);
  const [clip, setClip] = useState<File | null>(null);
  const [run, setRun] = useState<ReferenceRun>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    []
  );

  const analyse = async (): Promise<ReferenceStyle | null> => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setRun({ kind: 'running' });

    try {
      const { analyzeReference } = await import('@/infrastructure/style/analyze-reference');
      const style = await analyzeReference({ image, clip }, next.signal);

      if (controller.current !== next) return null;

      setRun({ kind: 'ready', style });

      return style;
    } catch (error) {
      if (controller.current === next && !next.signal.aborted) {
        setRun({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }

      return null;
    }
  };

  const reset = (): void => {
    controller.current?.abort();
    setRun({ kind: 'idle' });
  };

  return {
    image,
    clip,
    run,
    analyse,
    setImage: (file: File | null) => {
      setImage(file);
      reset();
    },
    setClip: (file: File | null) => {
      setClip(file);
      reset();
    },
  };
}
