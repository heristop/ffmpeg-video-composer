import { transcriptionRuns, transcribeUnlessCancelled } from './transcription-runs';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function recorder() {
  const saved: string[] = [];

  return {
    saved,
    save: async (result: string) => {
      saved.push(result);
    },
  };
}

describe('transcribeUnlessCancelled', () => {
  it('saves the transcription of the latest run', async () => {
    const { saved, save } = recorder();

    await expect(transcribeUnlessCancelled(transcriptionRuns(), async () => 'words', save)).resolves.toBe(true);
    expect(saved).toEqual(['words']);
  });

  it('drops a transcription finishing after captions were turned off', async () => {
    const runs = transcriptionRuns();
    const work = deferred<string>();
    const { saved, save } = recorder();
    const pending = transcribeUnlessCancelled(runs, () => work.promise, save);

    runs.cancel();
    work.resolve('words');

    await expect(pending).resolves.toBe(false);
    expect(saved).toEqual([]);
  });

  it('drops an older run superseded by a newer one', async () => {
    const runs = transcriptionRuns();
    const first = deferred<string>();
    const { saved, save } = recorder();
    const older = transcribeUnlessCancelled(runs, () => first.promise, save);
    const newer = transcribeUnlessCancelled(runs, async () => 'new', save);

    await newer;
    first.resolve('old');

    await expect(older).resolves.toBe(false);
    expect(saved).toEqual(['new']);
  });

  it('swallows the failure of a cancelled run', async () => {
    const runs = transcriptionRuns();
    const work = deferred<string>();
    const { save } = recorder();
    const pending = transcribeUnlessCancelled(
      runs,
      async () => {
        await work.promise;
        throw new Error('boom');
      },
      save
    );

    runs.cancel();
    work.resolve('');

    await expect(pending).resolves.toBe(false);
  });
});
