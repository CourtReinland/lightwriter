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

function assetForLocalStorage(asset: GeneratedAsset): GeneratedAsset {
  if (!asset.filePath || !asset.imageDataUrl) return asset;
  const { imageDataUrl: _imageDataUrl, ...metadataOnlyAsset } = asset;
  return metadataOnlyAsset;
}

function assetsForLocalStorage(assets: GeneratedAsset[]): GeneratedAsset[] {
  return assets.map(assetForLocalStorage);
}

export class AssetService {
  static getAssets(projectId: string): GeneratedAsset[] {
    const key = assetKey(projectId);
    const rawAssets = localStorage.getItem(key);
    const assets = safeParseAssets(rawAssets);
    const metadataAssets = assetsForLocalStorage(assets);
    const metadataPayload = JSON.stringify(metadataAssets);

    if (rawAssets && metadataPayload !== rawAssets) {
      try {
        localStorage.setItem(key, metadataPayload);
      } catch {
        // Best-effort migration only. Return the compact in-memory assets so the UI can
        // hydrate thumbnails from Electron file storage even if old LevelDB data is sticky.
      }
    }

    return metadataAssets;
  }

  static saveAssets(projectId: string, assets: GeneratedAsset[]): void {
    const metadataAssets = assetsForLocalStorage(assets);
    try {
      localStorage.setItem(assetKey(projectId), JSON.stringify(metadataAssets));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Project asset metadata could not be saved locally: ${message}`);
    }
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
