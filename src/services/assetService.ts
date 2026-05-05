import type { GeneratedAsset } from "../types/assets";

const assetKey = (projectId: string) => `lw-assets-${projectId}`;

function generateId(): string {
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeParseAssets(data: string | null): GeneratedAsset[] {
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class AssetService {
  static getAssets(projectId: string): GeneratedAsset[] {
    return safeParseAssets(localStorage.getItem(assetKey(projectId)));
  }

  static saveAssets(projectId: string, assets: GeneratedAsset[]): void {
    localStorage.setItem(assetKey(projectId), JSON.stringify(assets));
  }

  static addAsset(projectId: string, asset: GeneratedAsset): GeneratedAsset {
    const now = Date.now();
    const next: GeneratedAsset = {
      ...asset,
      id: asset.id || generateId(),
      projectId,
      createdAt: asset.createdAt || now,
      updatedAt: now,
    };
    this.saveAssets(projectId, [...this.getAssets(projectId), next]);
    return next;
  }

  static updateAsset(projectId: string, assetId: string, updates: Partial<GeneratedAsset>): GeneratedAsset | null {
    let updated: GeneratedAsset | null = null;
    const assets = this.getAssets(projectId).map((asset) => {
      if (asset.id !== assetId) return asset;
      updated = { ...asset, ...updates, id: asset.id, projectId, updatedAt: Date.now() };
      return updated;
    });
    this.saveAssets(projectId, assets);
    return updated;
  }

  static deleteAsset(projectId: string, assetId: string): void {
    this.saveAssets(
      projectId,
      this.getAssets(projectId).filter((asset) => asset.id !== assetId),
    );
  }

  static getAssetsForScene(projectId: string, sceneIndex: number): GeneratedAsset[] {
    return this.getAssets(projectId).filter((asset) => asset.scriptRef.sceneIndex === sceneIndex);
  }

  static getAssetsForCharacter(projectId: string, characterName: string): GeneratedAsset[] {
    const normalized = characterName.trim().toUpperCase();
    return this.getAssets(projectId).filter(
      (asset) => asset.scriptRef.characterName?.trim().toUpperCase() === normalized,
    );
  }
}
