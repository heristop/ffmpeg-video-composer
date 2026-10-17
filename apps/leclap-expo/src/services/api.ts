import { appStorage } from './mmkv';
import type { Project, Orientation } from '@/src/types';

// Local project persistence (MMKV). The app is fully local — there is no compile/template
// server, so this module only stores the user's projects on-device.
const PROJECTS_STORAGE_KEY = 'le_clap_projects';

/**
 * Recorded clips keyed by section name → the file URI the compiler reads, plus the orientation and
 * optional user edits (crop is normalized 0..1) applied before compilation.
 */
export type CompileRecordedVideos = Record<
  string,
  {
    path: string;
    orientation: Orientation;
    trim?: { start: number; end: number };
    crop?: { x: number; y: number; w: number; h: number };
  }
>;

/** Saves a project to local storage (insert or replace by id). */
export const saveProject = async (project: Project): Promise<void> => {
  try {
    const projectsJson = await appStorage.getItem(PROJECTS_STORAGE_KEY);
    const projects: Project[] = projectsJson ? (JSON.parse(projectsJson) as Project[]) : [];

    const existingIndex = projects.findIndex((p) => p.id === project.id);

    if (existingIndex !== -1) {
      projects[existingIndex] = project;
    }

    if (existingIndex === -1) {
      projects.push(project);
    }

    await appStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  } catch (error) {
    console.error('Error saving project:', error);

    throw error;
  }
};

/** Gets all projects from local storage. */
export const getProjects = async (): Promise<Project[]> => {
  try {
    const projectsJson = await appStorage.getItem(PROJECTS_STORAGE_KEY);

    return projectsJson ? (JSON.parse(projectsJson) as Project[]) : [];
  } catch (error) {
    console.error('Error getting projects:', error);

    throw error;
  }
};

/** Gets a project by id from local storage. */
export const getProjectById = async (projectId: string): Promise<Project | null> => {
  try {
    const projects = await getProjects();

    return projects.find((p) => p.id === projectId) ?? null;
  } catch (error) {
    console.error(`Error getting project ${projectId}:`, error);

    throw error;
  }
};

/** Deletes a project from local storage. */
export const deleteProject = async (projectId: string): Promise<void> => {
  try {
    const projects = await getProjects();
    const updatedProjects = projects.filter((p) => p.id !== projectId);
    await appStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(updatedProjects));
  } catch (error) {
    console.error(`Error deleting project ${projectId}:`, error);

    throw error;
  }
};

/** Deletes all projects from local storage. */
export const deleteAllProjects = async (): Promise<void> => {
  try {
    await appStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify([]));
  } catch (error) {
    console.error('Error deleting all projects:', error);

    throw error;
  }
};
