/**
 * Project persistence using localStorage.
 * Supports multiple named projects with auto-save.
 */

export interface Project {
  id: string;
  name: string;
  content: string;
  targetPages: number;
  activeFrameworks: string[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "lw-projects";
const ACTIVE_KEY = "lw-active-project";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export class StorageService {
  /**
   * Get all saved projects (metadata only, no content for listing).
   */
  static listProjects(): Omit<Project, "content">[] {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    try {
      const projects: Project[] = JSON.parse(data);
      return projects
        .map(({ id, name, targetPages, activeFrameworks, createdAt, updatedAt }) => ({
          id,
          name,
          targetPages,
          activeFrameworks,
          createdAt,
          updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /**
   * Get a full project by ID.
   */
  static getProject(id: string): Project | null {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    try {
      const projects: Project[] = JSON.parse(data);
      return projects.find((p) => p.id === id) || null;
    } catch {
      return null;
    }
  }

  /**
   * Save or update a project.
   */
  static saveProject(project: Project): void {
    const data = localStorage.getItem(STORAGE_KEY);
    let projects: Project[] = [];
    try {
      projects = data ? JSON.parse(data) : [];
    } catch {
      projects = [];
    }

    const index = projects.findIndex((p) => p.id === project.id);
    project.updatedAt = Date.now();

    if (index >= 0) {
      projects[index] = project;
    } else {
      projects.push(project);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }

  /**
   * Create a new project.
   */
  static createProject(name: string, content = "", targetPages = 120): Project {
    const project: Project = {
      id: generateId(),
      name,
      content,
      targetPages,
      activeFrameworks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.saveProject(project);
    return project;
  }

  /**
   * Delete a project by ID.
   */
  static deleteProject(id: string): void {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return;
    try {
      let projects: Project[] = JSON.parse(data);
      projects = projects.filter((p) => p.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch {
      // ignore
    }
  }

  /**
   * Rename a project.
   */
  static renameProject(id: string, newName: string): void {
    const project = this.getProject(id);
    if (project) {
      project.name = newName;
      this.saveProject(project);
    }
  }

  /**
   * Get/set the active project ID.
   */
  static getActiveProjectId(): string | null {
    return localStorage.getItem(ACTIVE_KEY);
  }

  static setActiveProjectId(id: string): void {
    localStorage.setItem(ACTIVE_KEY, id);
  }

  /**
   * Migrate legacy single-document storage to project format.
   * Called once on first load.
   */
  static migrateLegacy(): Project | null {
    const legacyContent = localStorage.getItem("lw-content");
    if (!legacyContent) return null;

    // Check if we already have projects
    const existing = this.listProjects();
    if (existing.length > 0) return null;

    // Migrate
    const legacyTarget = localStorage.getItem("lw-target-pages");
    const legacyFrameworks = localStorage.getItem("lw-frameworks");

    const project = this.createProject(
      "Untitled Screenplay",
      JSON.parse(legacyContent),
      legacyTarget ? JSON.parse(legacyTarget) : 30,
    );

    if (legacyFrameworks) {
      project.activeFrameworks = JSON.parse(legacyFrameworks);
      this.saveProject(project);
    }

    this.setActiveProjectId(project.id);

    // Clean up legacy keys
    localStorage.removeItem("lw-content");
    localStorage.removeItem("lw-target-pages");
    localStorage.removeItem("lw-frameworks");

    return project;
  }
}
