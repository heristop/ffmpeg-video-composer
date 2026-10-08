// Turning captions off (or starting a newer transcription) supersedes a transcription still running: its
// result must not be saved over the user's later choice. Each run takes a ticket; only the latest saves.

export interface TranscriptionRuns {
  /** A new run, superseding every earlier one. */
  start(): number;
  /** Supersedes every running transcription (captions turned off). */
  cancel(): void;
  isCurrent(run: number): boolean;
}

export function transcriptionRuns(): TranscriptionRuns {
  let latest = 0;

  return {
    start: () => {
      latest += 1;

      return latest;
    },
    cancel: () => {
      latest += 1;
    },
    isCurrent: (run) => run === latest,
  };
}

/** Runs `work` and saves its result unless superseded meanwhile; true when saved. A superseded failure is dropped. */
export async function transcribeUnlessCancelled<T>(
  runs: TranscriptionRuns,
  work: () => Promise<T>,
  save: (result: T) => Promise<void>
): Promise<boolean> {
  const run = runs.start();

  try {
    const result = await work();

    if (!runs.isCurrent(run)) return false;

    await save(result);

    return true;
  } catch (error) {
    if (!runs.isCurrent(run)) return false;

    throw error;
  }
}
