import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  saveDraft,
  loadProject,
  saveCompleted,
  deleteProject,
  renameProject,
  duplicateProject,
} from './projectService';
import { projectBlobStore } from './projectBlobBackend';
import { projectStore } from '@/stores/projectStore';
import { templateService, type Template } from '@/services/templateService';
import { EMPTY_MODEL, type WizardModel } from '@/lib/wizardModel';
import type { StoredProject } from '@/lib/projectModel';

// Shared in-memory state for the mocked singletons (hoisted above the vi.mock factories).
const state = vi.hoisted(() => ({
  blobs: new Map<string, Uint8Array>(),
  projects: new Map<string, unknown>(),
  counter: { n: 0 },
}));

vi.mock('./projectBlobBackend', () => ({
  projectBlobStore: {
    put: vi.fn(async (bytes: Uint8Array) => {
      const key = `blob-${(state.counter.n += 1)}`;
      state.blobs.set(key, bytes);

      return key;
    }),
    get: vi.fn(async (key: string) => state.blobs.get(key) ?? null),
    delete: vi.fn(async (key: string) => {
      state.blobs.delete(key);
    }),
    has: vi.fn(async (key: string) => state.blobs.has(key)),
  },
}));

vi.mock('@/stores/projectStore', () => ({
  projectStore: {
    list: () => [...state.projects.values()],
    get: (id: string) => state.projects.get(id) ?? null,
    save: (project: StoredProject) => {
      state.projects.set(project.id, project);

      return project;
    },
    remove: (id: string) => {
      state.projects.delete(id);
    },
  },
}));

const TEMPLATE = {
  id: 'tpl-1',
  name: 'Spotlight',
  description: '',
  orientation: 'portrait',
  hasForm: true,
  complexity: 'simple',
  source: 'sample',
  descriptor: {},
} as Template;

vi.mock('@/services/templateService', () => ({
  templateService: { getTemplate: vi.fn(async () => TEMPLATE) },
}));

const file = (name: string, bytes: number[]): File => new File([new Uint8Array(bytes)], name, { type: 'video/mp4' });

const modelWith = (over: Partial<WizardModel>): WizardModel => ({ ...EMPTY_MODEL, ...over });

describe('projectService IO orchestration', () => {
  beforeEach(() => {
    state.blobs.clear();
    state.projects.clear();
    state.counter.n = 0;
    (projectBlobStore.put as Mock).mockClear();
    vi.mocked(templateService.getTemplate).mockResolvedValue(TEMPLATE);
  });

  it('saves a draft: writes the clip blob and records its metadata', async () => {
    const model = modelWith({ formData: { name: 'Ada' }, clipsBySection: { video_1: file('clip.mp4', [1, 2, 3]) } });

    const saved = await saveDraft(model, TEMPLATE);

    expect(saved.status).toBe('draft');
    expect(saved.formData).toEqual({ name: 'Ada' });
    expect(saved.clips.video_1).toMatchObject({ name: 'clip.mp4', type: 'video/mp4', size: 3 });
    expect(state.blobs.size).toBe(1);
  });

  it('does not rewrite an unchanged clip on the next save', async () => {
    const clip = file('clip.mp4', [1, 2, 3]);
    const saved = await saveDraft(modelWith({ clipsBySection: { video_1: clip } }), TEMPLATE);

    expect((projectBlobStore.put as Mock).mock.calls).toHaveLength(1);

    // Same file (same name + size) → diff finds nothing to write.
    await saveDraft(modelWith({ clipsBySection: { video_1: clip }, stepIndex: 2 }), TEMPLATE, saved.id);

    expect((projectBlobStore.put as Mock).mock.calls).toHaveLength(1);
    expect(state.blobs.size).toBe(1);
  });

  it('round-trips through loadProject, reconstructing the clip File', async () => {
    const saved = await saveDraft(
      modelWith({ formData: { name: 'Ada' }, clipsBySection: { video_1: file('clip.mp4', [9, 8, 7]) }, stepIndex: 1 }),
      TEMPLATE
    );

    const result = await loadProject(saved.id);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.template.id).toBe('tpl-1');
      expect(result.model.formData).toEqual({ name: 'Ada' });
      expect(result.model.stepIndex).toBe(1);
      expect(result.model.clipsBySection.video_1).toBeInstanceOf(File);
      expect(result.model.clipsBySection.video_1.name).toBe('clip.mp4');
    }
  });

  it('marks a project completed and stores its output blob', async () => {
    const saved = await saveDraft(modelWith({ clipsBySection: { video_1: file('c.mp4', [1]) } }), TEMPLATE);

    const completed = await saveCompleted(saved.id, { blob: new Blob([new Uint8Array([4, 5])]), size: 2, duration: 6 });

    expect(completed?.status).toBe('completed');
    expect(completed?.output).toMatchObject({ size: 2, duration: 6 });
    expect(state.blobs.size).toBe(2); // clip + output
  });

  it('deletes a project and purges all of its blobs', async () => {
    const saved = await saveDraft(modelWith({ clipsBySection: { video_1: file('c.mp4', [1]) } }), TEMPLATE);
    await saveCompleted(saved.id, { blob: new Blob([new Uint8Array([4])]), size: 1 });

    await deleteProject(saved.id);

    expect(projectStore.get(saved.id)).toBeNull();
    expect(state.blobs.size).toBe(0);
  });

  it('renames a project and keeps the name across the next auto-save', async () => {
    const saved = await saveDraft(modelWith({ formData: { name: 'Ada' } }), TEMPLATE);

    const renamed = renameProject(saved.id, 'My birthday reel');
    expect(renamed?.name).toBe('My birthday reel');

    // A later auto-save must not clobber the custom name back to the template name.
    const resaved = await saveDraft(modelWith({ formData: { name: 'Ada' }, stepIndex: 1 }), TEMPLATE, saved.id);
    expect(resaved.name).toBe('My birthday reel');
  });

  it('blank rename keeps the existing name', () => {
    const id = 'p-x';
    state.projects.set(id, { id, name: 'Keep me', templateId: 'tpl-1', clips: {}, updatedAt: 1 });

    expect(renameProject(id, '   ')?.name).toBe('Keep me');
  });

  it('duplicates into a fresh draft with its own clip blobs', async () => {
    const source = await saveDraft(modelWith({ clipsBySection: { video_1: file('c.mp4', [1, 2]) } }), TEMPLATE);
    await saveCompleted(source.id, { blob: new Blob([new Uint8Array([9])]), size: 1 });

    const copy = await duplicateProject(source.id);

    expect(copy?.id).not.toBe(source.id);
    expect(copy?.status).toBe('draft');
    expect(copy?.output).toBeUndefined();
    expect(copy?.name).toContain('(copy)');
    // The copy points at different blob keys, so deleting the source leaves the copy intact.
    expect(copy?.clips.video_1.blobKey).not.toBe(source.clips.video_1.blobKey);

    await deleteProject(source.id);
    const reloaded = await loadProject(copy!.id);
    expect(reloaded.ok).toBe(true);

    if (reloaded.ok) expect(reloaded.model.clipsBySection.video_1).toBeInstanceOf(File);
  });

  it('persists every take and shares the selected clip blobKey (no double-write)', async () => {
    const takeA = file('take-a.mp4', [1, 2, 3]);
    const takeB = file('take-b.mp4', [4, 5]);
    const model = modelWith({
      clipsBySection: { video_1: takeB },
      rushesBySection: { video_1: [takeA, takeB] },
    });

    const saved = await saveDraft(model, TEMPLATE);

    expect(saved.rushes?.video_1).toHaveLength(2);
    // One blob per distinct take — the selected clip is not written a second time.
    expect((projectBlobStore.put as Mock).mock.calls).toHaveLength(2);
    expect(state.blobs.size).toBe(2);

    const rushKeys = saved.rushes!.video_1.map((take) => take.blobKey);
    expect(rushKeys).toContain(saved.clips.video_1.blobKey);
    expect(saved.clips.video_1).toMatchObject({ name: 'take-b.mp4', size: 2 });
  });

  it('round-trips rushes through loadProject (all takes + selected restored)', async () => {
    const takeA = file('take-a.mp4', [1, 2, 3]);
    const takeB = file('take-b.mp4', [4, 5]);
    const saved = await saveDraft(
      modelWith({ clipsBySection: { video_1: takeB }, rushesBySection: { video_1: [takeA, takeB] } }),
      TEMPLATE
    );

    const result = await loadProject(saved.id);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.model.rushesBySection.video_1).toHaveLength(2);
      expect(result.model.rushesBySection.video_1.map((f) => f.name)).toEqual(['take-a.mp4', 'take-b.mp4']);
      expect(result.model.clipsBySection.video_1.name).toBe('take-b.mp4');
    }
  });

  it('deletes every rush blob when the project is removed', async () => {
    const saved = await saveDraft(
      modelWith({
        clipsBySection: { video_1: file('b.mp4', [4, 5]) },
        rushesBySection: { video_1: [file('a.mp4', [1, 2, 3]), file('b.mp4', [4, 5])] },
      }),
      TEMPLATE
    );

    expect(state.blobs.size).toBe(2);

    await deleteProject(saved.id);

    expect(state.blobs.size).toBe(0);
    expect(projectStore.get(saved.id)).toBeNull();
  });

  it('duplicates rushes into fresh blobs with a shared selected clip key', async () => {
    const source = await saveDraft(
      modelWith({
        clipsBySection: { video_1: file('b.mp4', [4, 5]) },
        rushesBySection: { video_1: [file('a.mp4', [1, 2, 3]), file('b.mp4', [4, 5])] },
      }),
      TEMPLATE
    );

    const copy = await duplicateProject(source.id);

    expect(copy?.rushes?.video_1).toHaveLength(2);
    const copyKeys = copy!.rushes!.video_1.map((t) => t.blobKey);
    expect(copyKeys).not.toContain(source.rushes!.video_1[0].blobKey);
    expect(copyKeys).toContain(copy!.clips.video_1.blobKey);

    await deleteProject(source.id);
    const reloaded = await loadProject(copy!.id);
    expect(reloaded.ok).toBe(true);

    if (reloaded.ok) expect(reloaded.model.rushesBySection.video_1).toHaveLength(2);
  });

  it('reports template-removed when the project references a missing template', async () => {
    const saved = await saveDraft(modelWith({ clipsBySection: {} }), TEMPLATE);
    vi.mocked(templateService.getTemplate).mockResolvedValueOnce(null);

    const result = await loadProject(saved.id);

    expect(result).toEqual({ ok: false, reason: 'template-removed' });
  });

  it('reopens the template in the format the project was saved in', async () => {
    const saved = await saveDraft(modelWith({ clipsBySection: {} }), TEMPLATE);

    await loadProject(saved.id);

    // The template service maps a retired variant id (present-yourself-portrait) to its merged template.
    expect(templateService.getTemplate).toHaveBeenCalledWith('tpl-1', 'portrait');
  });
});
