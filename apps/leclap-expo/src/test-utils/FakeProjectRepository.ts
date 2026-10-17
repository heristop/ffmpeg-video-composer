import type { Project } from '@/src/domain/entities/Project';
import type { ProjectStatus } from '@/src/domain/valueObjects/ProjectStatus';
import type { IProjectRepository } from '@/src/domain/repositories/IProjectRepository';

/**
 * In-memory IProjectRepository for unit-testing use cases without any storage backend.
 */
export class FakeProjectRepository implements IProjectRepository {
  private readonly store = new Map<string, Project>();

  constructor(seed: Project[] = []) {
    for (const project of seed) {
      this.store.set(project.id, project);
    }
  }

  save(project: Project): Promise<Project> {
    this.store.set(project.id, project);

    return Promise.resolve(project);
  }

  findById(id: string): Promise<Project | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  findAll(): Promise<Project[]> {
    return Promise.resolve([...this.store.values()]);
  }

  delete(id: string): Promise<void> {
    this.store.delete(id);

    return Promise.resolve();
  }

  deleteAll(): Promise<void> {
    this.store.clear();

    return Promise.resolve();
  }

  findByStatus(status: string): Promise<Project[]> {
    const projectStatus = status as ProjectStatus;

    return Promise.resolve([...this.store.values()].filter((p) => p.status === projectStatus));
  }

  findByTemplate(templateName: string): Promise<Project[]> {
    return Promise.resolve([...this.store.values()].filter((p) => p.templateName === templateName));
  }

  // Test helpers
  count(): number {
    return this.store.size;
  }

  has(id: string): boolean {
    return this.store.has(id);
  }
}
