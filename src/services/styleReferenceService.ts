export interface ScriptStyleReference {
  projectId: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  updatedAt: number;
}

const keyFor = (projectId: string) => `lw-style-reference-${projectId}`;

export class StyleReferenceService {
  static get(projectId: string): ScriptStyleReference | null {
    const raw = localStorage.getItem(keyFor(projectId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ScriptStyleReference;
      if (!parsed || !parsed.dataUrl || !parsed.name) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  static save(projectId: string, input: { name: string; mimeType: string; dataUrl: string }): ScriptStyleReference {
    const reference: ScriptStyleReference = {
      projectId,
      name: input.name,
      mimeType: input.mimeType,
      dataUrl: input.dataUrl,
      updatedAt: Date.now(),
    };
    localStorage.setItem(keyFor(projectId), JSON.stringify(reference));
    return reference;
  }

  static clear(projectId: string): void {
    localStorage.removeItem(keyFor(projectId));
  }
}
