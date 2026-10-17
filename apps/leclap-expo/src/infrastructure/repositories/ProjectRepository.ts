import { appStorage } from '@/src/services/mmkv';
import { Project } from '@/src/domain/entities/Project';
import type { ProjectStatus } from '@/src/domain/valueObjects/ProjectStatus';
import type { IProjectRepository } from '@/src/domain/repositories/IProjectRepository';

const PROJECTS_STORAGE_KEY = 'le_clap_projects';

export class ProjectRepository implements IProjectRepository {
  private async getStoredProjects(): Promise<Project[]> {
    try {
      const stored = await appStorage.getItem(PROJECTS_STORAGE_KEY);

      if (!stored) return [];

      const projectsData = JSON.parse(stored) as unknown;

      if (!Array.isArray(projectsData)) return [];

      return projectsData
        .filter(
          (data): data is Record<string, unknown> => data !== null && typeof data === 'object' && !Array.isArray(data)
        )
        .map((data) => Project.fromJSON(data));
    } catch (error) {
      console.error('Error loading projects from storage:', error);

      return [];
    }
  }

  private async storeProjects(projects: Project[]): Promise<void> {
    try {
      const projectsData = projects.map((project) => project.toJSON());
      await appStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projectsData));
    } catch (error) {
      console.error('Error storing projects:', error);

      throw error;
    }
  }

  async findAll(): Promise<Project[]> {
    return this.getStoredProjects();
  }

  async findById(id: string): Promise<Project | null> {
    const projects = await this.getStoredProjects();

    return projects.find((project) => project.id === id) ?? null;
  }

  async findByStatus(status: string): Promise<Project[]> {
    const projects = await this.getStoredProjects();

    const projectStatus = status as ProjectStatus;

    return projects.filter((project) => project.status === projectStatus);
  }

  async findByTemplate(templateName: string): Promise<Project[]> {
    const projects = await this.getStoredProjects();

    return projects.filter((project) => project.templateName === templateName);
  }

  async save(project: Project): Promise<Project> {
    const projects = await this.getStoredProjects();
    const existingIndex = projects.findIndex((p) => p.id === project.id);

    if (existingIndex >= 0) {
      projects[existingIndex] = project;
    }

    if (existingIndex < 0) {
      projects.push(project);
    }

    await this.storeProjects(projects);

    return project;
  }

  async delete(id: string): Promise<void> {
    const projects = await this.getStoredProjects();
    const filteredProjects = projects.filter((project) => project.id !== id);
    await this.storeProjects(filteredProjects);
  }

  async deleteAll(): Promise<void> {
    await appStorage.removeItem(PROJECTS_STORAGE_KEY);
  }
}
