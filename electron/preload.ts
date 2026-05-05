import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("lightwriterAssets", {
  saveImageAsset: (request: { projectId: string; assetId?: string; name: string; mimeType: string; dataUrl: string }) =>
    ipcRenderer.invoke("lightwriter:save-asset-image", request),
});
