export interface LightWriterAssetBridge {
  saveImageAsset?: (request: { projectId: string; assetId?: string; name: string; mimeType: string; dataUrl: string }) => Promise<{ filePath: string }>;
  loadImageAsset?: (request: { filePath: string }) => Promise<{ dataUrl: string }>;
}

declare global {
  interface Window {
    lightwriterAssets?: LightWriterAssetBridge;
  }
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

export function assetDownloadFilename(name: string, mimeType: string): string {
  const safeName = name
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "lightwriter_asset";
  return `${safeName}.${extensionForMimeType(mimeType)}`;
}

export async function persistGeneratedImageFile(args: {
  projectId: string;
  assetId?: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
}): Promise<string | undefined> {
  if (!args.dataUrl) return undefined;
  const bridge = typeof window !== "undefined" ? window.lightwriterAssets : undefined;
  if (!bridge?.saveImageAsset) return undefined;
  const result = await bridge.saveImageAsset({
    projectId: args.projectId,
    assetId: args.assetId,
    name: args.name,
    mimeType: args.mimeType,
    dataUrl: args.dataUrl,
  });
  return result.filePath;
}

export async function loadPersistedImageDataUrl(filePath?: string): Promise<string | undefined> {
  if (!filePath) return undefined;
  const bridge = typeof window !== "undefined" ? window.lightwriterAssets : undefined;
  if (!bridge?.loadImageAsset) return undefined;
  const result = await bridge.loadImageAsset({ filePath });
  return result.dataUrl;
}

export function downloadImageDataUrl(args: { name: string; mimeType: string; dataUrl?: string }): void {
  if (!args.dataUrl || typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = args.dataUrl;
  anchor.download = assetDownloadFilename(args.name, args.mimeType);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
