import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompileError } from '@/application/usecases/compile-failure';
import type { EditorState } from '../templateEditorModel';
import {
  createPreviewRenderController,
  idlePreviewView,
  renderPreview,
  type PreviewRenderView,
  type PreviewRenderer,
} from './usePreviewRender';

const mocks = vi.hoisted(() => ({
  compileVideo: vi.fn(),
  generatePlaceholderClips: vi.fn(),
  buildPreviewPlan: vi.fn(),
}));

vi.mock('@/application/usecases/coreCompilationService', () => ({
  coreCompilationService: { compileVideo: mocks.compileVideo },
}));
vi.mock('./placeholderClips', () => ({ generatePlaceholderClips: mocks.generatePlaceholderClips }));
vi.mock('./previewRender', () => ({ buildPreviewPlan: mocks.buildPreviewPlan }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const state = { orientation: 'landscape', sections: [] } as unknown as EditorState;

function harness(render: PreviewRenderer) {
  let view: PreviewRenderView = idlePreviewView;
  const controller = createPreviewRenderController(
    (update) => {
      view = { ...view, ...update };
    },
    render,
    () => 1000
  );

  return { controller, view: () => view };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('preview render controller', () => {
  it('opens the dialog, reports progress and keeps the output URL', async () => {
    const { controller, view } = harness(async (_state, onProgress) => {
      onProgress({ ...idlePreviewView.progress, stage: 'Compiling', percentage: 50 });

      expect(view()).toMatchObject({ open: true, rendering: true, result: null, failure: null });
      expect(view().progress.percentage).toBe(50);

      return 'blob:out';
    });

    await expect(controller.start(state)).resolves.toEqual({ status: 'done', url: 'blob:out', elapsedMs: 0 });
    expect(view()).toMatchObject({ open: true, rendering: false, result: { url: 'blob:out' }, failure: null });
  });

  it('reports busy instead of starting a second render', async () => {
    const pending = deferred<string>();
    const render = vi.fn<PreviewRenderer>(() => pending.promise);
    const { controller } = harness(render);
    const first = controller.start(state);

    await expect(controller.start(state)).resolves.toEqual({ status: 'busy' });
    pending.resolve('blob:a');
    await first;

    expect(render).toHaveBeenCalledTimes(1);
  });

  it('classifies a failure and passes the abort signal through', async () => {
    const abort = new AbortController();
    const render = vi.fn<PreviewRenderer>(() => Promise.reject(new CompileError({ kind: 'stopped', detail: '' })));
    const { controller, view } = harness(render);

    await expect(controller.start(state, abort.signal)).resolves.toMatchObject({
      status: 'failed',
      failure: { kind: 'stopped' },
    });
    expect(render.mock.calls[0][2]).toBe(abort.signal);
    expect(view()).toMatchObject({ rendering: false, failure: { kind: 'stopped' } });
  });

  it('stays open while rendering, and closing frees the output', async () => {
    const pending = deferred<string>();
    const { controller, view } = harness(() => pending.promise);
    const run = controller.start(state);

    controller.onOpenChange(false);
    expect(view().open).toBe(true);
    pending.resolve('blob:x');
    await run;

    controller.onOpenChange(false);
    expect(view()).toMatchObject({ open: false, result: null, failure: null });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });
});

describe('renderPreview', () => {
  it('compiles the preview plan with placeholder clips at the ultrafast preset', async () => {
    const files = [new File([], 'preview_1.mp4')];
    const onProgress = vi.fn();
    const abort = new AbortController();
    mocks.buildPreviewPlan.mockReturnValue({
      template: { id: 't' },
      formData: { a: 'b' },
      videoConfig: {},
      clipCount: 1,
    });
    mocks.generatePlaceholderClips.mockResolvedValue(files);
    mocks.compileVideo.mockResolvedValue({ url: 'blob:preview' });

    await expect(renderPreview(state, onProgress, abort.signal)).resolves.toBe('blob:preview');
    expect(mocks.generatePlaceholderClips).toHaveBeenCalledWith(state, 1);
    expect(mocks.compileVideo).toHaveBeenCalledWith(
      { template: { id: 't' }, formData: { a: 'b' }, files, videoConfig: {}, preset: 'ultrafast' },
      onProgress,
      abort.signal
    );
  });

  it('stops before fetching clips when already aborted', async () => {
    const abort = new AbortController();
    abort.abort();

    await expect(renderPreview(state, vi.fn(), abort.signal)).rejects.toMatchObject({ failure: { kind: 'stopped' } });
    expect(mocks.generatePlaceholderClips).not.toHaveBeenCalled();
    expect(mocks.compileVideo).not.toHaveBeenCalled();
  });
});
