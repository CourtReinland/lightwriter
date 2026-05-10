export type StyleReferenceScope = "scene" | "character";

export interface ScriptStyleReference {
  projectId: string;
  scope: StyleReferenceScope;
  name: string;
  mimeType: string;
  dataUrl: string;
  updatedAt: number;
}

const legacyKeyFor = (projectId: string) => `lw-style-reference-${projectId}`;
const keyFor = (projectId: string, scope: StyleReferenceScope = "scene") =>
  scope === "scene" ? legacyKeyFor(projectId) : `lw-style-reference-${scope}-${projectId}`;

export class StyleReferenceService {
  static get(projectId: string, scope: StyleReferenceScope = "scene"): ScriptStyleReference | null {
    const raw = localStorage.getItem(keyFor(projectId, scope));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ScriptStyleReference;
      if (!parsed || !parsed.dataUrl || !parsed.name) return null;
      return { ...parsed, scope: parsed.scope || scope };
    } catch {
      return null;
    }
  }

  static save(projectId: string, input: { scope?: StyleReferenceScope; name: string; mimeType: string; dataUrl: string }): ScriptStyleReference {
    const scope = input.scope || "scene";
    const reference: ScriptStyleReference = {
      projectId,
      scope,
      name: input.name,
      mimeType: input.mimeType,
      dataUrl: input.dataUrl,
      updatedAt: Date.now(),
    };
    localStorage.setItem(keyFor(projectId, scope), JSON.stringify(reference));
    return reference;
  }

  static clear(projectId: string, scope: StyleReferenceScope = "scene"): void {
    localStorage.removeItem(keyFor(projectId, scope));
  }
}
