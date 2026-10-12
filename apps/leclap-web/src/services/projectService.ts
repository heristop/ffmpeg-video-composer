import { templateService, type Template } from '@/services/templateService';
import { projectStore } from '@/stores/projectStore';
import { projectBlobStore } from '@/services/projectBlobBackend';
import { modelToProject, projectToModel, type StoredClip, type StoredProject } from '@/lib/projectModel';
import { deriveSelectedClips, diffRushes, materializeRushes, withSelectedRushes } from '@/services/projectRushes';
import type { WizardModel } from '@/lib/wizardModel';

export interface ClipDiff {
  // Section names whose clip needs a fresh blob written (new or replaced).
  write: string[];
  // Blob keys to delete (clips that were removed or replaced).
  prune: string[];
}

// Index access that is honest about absence (the tsconfig doesn't enable noUncheckedIndexedAccess).
const pick = <T>(record: Record<string, T>, key: string): T | undefined => record[key];

// Pure: compare the previously stored clip metadata against the current model. A clip is "unchanged"
// when its file name + size match — enough to skip re-writing the same bytes between auto-saves.
export function diffClips(prevClips: Record<string, StoredClip>, clipsBySection: Record<string, File>): ClipDiff {
  const write: string[] = [];
  const prune: string[] = [];
  const sections = new Set([...Object.keys(prevClips), ...Object.keys(clipsBySection)]);

  for (const section of sections) {
    const prev = pick(prevClips, section);
    const file = pick(clipsBySection, section);

    if (!file) {
      if (prev) prune.push(prev.blobKey);

      continue;
    }

    if (prev && prev.name === file.name && prev.size === file.size) continue;

    write.push(section);

    if (prev) prune.push(prev.blobKey);
  }

  return { write, prune };
}

function makeId(): string {
  try {
    return `project-${globalThis.crypto.randomUUID()}`;
  } catch {
    return `project-${Date.now()}`;
  }
}

// Persist (or update) a draft: write any new take bytes, prune replaced/removed ones, then save the
// metadata record. Every recorded take is persisted; the selected clip shares the matching take's
// blobKey (no double-write). Editing always lands as a `draft` — a prior compiled output is invalidated.
export async function saveDraft(model: WizardModel, template: Template, currentId?: string): Promise<StoredProject> {
  const current = currentId ? (projectStore.get(currentId) ?? undefined) : undefined;
  const prevRushes = current?.rushes ?? {};
  const effectiveRushes = withSelectedRushes(model);
  const rushDiff = diffRushes(prevRushes, effectiveRushes);
  const rushes = await materializeRushes(prevRushes, { ...model, rushesBySection: effectiveRushes }, rushDiff);
  const clips = deriveSelectedClips(rushes, model);

  const stalePrune = current?.output ? [...rushDiff.prune, current.output.blobKey] : rushDiff.prune;
  await Promise.all(stalePrune.map((key) => projectBlobStore.delete(key)));

  return projectStore.save(
    modelToProject({
      id: current?.id ?? makeId(),
      model,
      template,
      clips,
      rushes,
      now: Date.now(),
      createdAt: current?.createdAt,
      name: current?.name,
      status: 'draft',
    })
  );
}

// Give a project a custom title (falls back to the existing name when blank).
export function renameProject(id: string, name: string): StoredProject | null {
  const current = projectStore.get(id);

  if (!current) return null;

  return projectStore.save({ ...current, name: name.trim() || current.name, updatedAt: Date.now() });
}

// Copy one stored take's bytes to a fresh blob key, preserving its metadata. Returns null if the
// source blob is missing so the caller can drop it.
async function copyTake(take: StoredClip): Promise<StoredClip | null> {
  const bytes = await projectBlobStore.get(take.blobKey);

  if (!bytes) return null;

  const blobKey = await projectBlobStore.put(bytes);

  return { ...take, blobKey };
}

// Copy every take of a project to fresh blobs, returning the new rushes map alongside a lookup from
// each old blob key to its copy so the selected clips can be re-pointed to the same bytes.
async function copyRushes(
  source: StoredProject
): Promise<{ rushes: Record<string, StoredClip[]>; byOldKey: Map<string, StoredClip> }> {
  const byOldKey = new Map<string, StoredClip>();
  const entries = await Promise.all(
    Object.entries(source.rushes ?? {}).map(async ([section, takes]) => {
      const copied = await Promise.all(takes.map((take) => copyTake(take)));
      const kept = takes
        .map((take, index) => [take, copied[index]] as const)
        .filter((pair): pair is readonly [StoredClip, StoredClip] => pair[1] !== null);

      for (const [old, fresh] of kept) byOldKey.set(old.blobKey, fresh);

      return [section, kept.map(([, fresh]) => fresh)] as const;
    })
  );

  return { rushes: Object.fromEntries(entries), byOldKey };
}

// Clone a project's takes + answers into a fresh draft (its own blob copies, no carried-over output).
// The copy's selected clip shares the copied take's blobKey, mirroring the source invariant.
export async function duplicateProject(id: string): Promise<StoredProject | null> {
  const source = projectStore.get(id);

  if (!source) return null;

  const { rushes, byOldKey } = await copyRushes(source);
  const clips = await duplicateClips(source, byOldKey);
  const now = Date.now();

  return projectStore.save({
    ...source,
    id: makeId(),
    name: `${source.name} (copy)`,
    status: 'draft',
    output: undefined,
    clips,
    rushes,
    createdAt: now,
    updatedAt: now,
  });
}

// Re-point each selected clip at its copied take (shared blobKey). Falls back to copying the clip's
// own bytes for legacy records whose selected clip isn't among the persisted takes.
async function duplicateClips(
  source: StoredProject,
  byOldKey: Map<string, StoredClip>
): Promise<Record<string, StoredClip>> {
  const entries = await Promise.all(
    Object.entries(source.clips).map(async ([section, clip]) => {
      const shared = byOldKey.get(clip.blobKey) ?? (await copyTake(clip));

      return shared ? ([section, shared] as const) : null;
    })
  );

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, StoredClip] => entry !== null));
}

export type LoadResult =
  | { ok: true; project: StoredProject; template: Template; model: WizardModel }
  | { ok: false; reason: 'not-found' | 'template-removed' };

// Read a project back into a builder-ready (template, model) pair, materializing clip Files from the
// blob store. Returns a typed failure when the project or its template no longer exists.
export async function loadProject(id: string): Promise<LoadResult> {
  const project = projectStore.get(id);

  if (!project) return { ok: false, reason: 'not-found' };

  // In the format it was saved in; a retired variant's id resolves to the template that absorbed it.
  const template = await templateService.getTemplate(project.templateId, project.orientation);

  if (!template) return { ok: false, reason: 'template-removed' };

  const entries = await Promise.all(
    Object.entries(project.clips).map(async ([section, meta]) => {
      const bytes = await projectBlobStore.get(meta.blobKey);

      return bytes ? ([section, new File([new Uint8Array(bytes)], meta.name, { type: meta.type })] as const) : null;
    })
  );

  const clipFiles = Object.fromEntries(entries.filter((entry): entry is readonly [string, File] => entry !== null));
  const rushFiles = await materializeRushFiles(project.rushes);

  return { ok: true, project, template, model: projectToModel(project, clipFiles, rushFiles) };
}

// Rebuild each take's File from the blob store, skipping any missing blob. Returns undefined for
// legacy records without persisted rushes so projectToModel falls back to the single-take path.
async function materializeRushFiles(
  rushes: Record<string, StoredClip[]> | undefined
): Promise<Record<string, File[]> | undefined> {
  if (!rushes) return undefined;

  const entries = await Promise.all(
    Object.entries(rushes).map(async ([section, takes]) => {
      const files = await Promise.all(
        takes.map(async (meta) => {
          const bytes = await projectBlobStore.get(meta.blobKey);

          return bytes ? new File([new Uint8Array(bytes)], meta.name, { type: meta.type }) : null;
        })
      );

      return [section, files.filter((file): file is File => file !== null)] as const;
    })
  );

  return Object.fromEntries(entries);
}

export interface CompiledOutput {
  blob: Blob;
  size: number;
  duration?: number;
}

// Persist a finished render against its project and flip it to `completed`.
export async function saveCompleted(projectId: string, output: CompiledOutput): Promise<StoredProject | null> {
  const current = projectStore.get(projectId);

  if (!current) return null;

  if (current.output) await projectBlobStore.delete(current.output.blobKey);

  const bytes = new Uint8Array(await output.blob.arrayBuffer());
  const blobKey = await projectBlobStore.put(bytes);

  return projectStore.save({
    ...current,
    status: 'completed',
    output: { blobKey, size: output.size, duration: output.duration },
    updatedAt: Date.now(),
  });
}

// Materialize a completed project's output blob so the result screen can re-open it without a recompile.
export async function loadOutput(project: StoredProject): Promise<CompiledOutput | null> {
  if (!project.output) return null;

  const bytes = await projectBlobStore.get(project.output.blobKey);

  if (!bytes) return null;

  return {
    blob: new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }),
    size: project.output.size,
    duration: project.output.duration,
  };
}

// Remove a project and every blob it owns (no orphans left in IndexedDB).
export async function deleteProject(id: string): Promise<void> {
  const project = projectStore.get(id);

  if (project) {
    const keys = new Set(Object.values(project.clips).map((clip) => clip.blobKey));

    for (const take of Object.values(project.rushes ?? {}).flat()) keys.add(take.blobKey);

    if (project.output) keys.add(project.output.blobKey);

    await Promise.all([...keys].map((key) => projectBlobStore.delete(key)));
  }

  projectStore.remove(id);
}

export function listProjects(): StoredProject[] {
  return [...projectStore.list()].sort((a, b) => b.updatedAt - a.updatedAt);
}
