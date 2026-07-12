import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("lightwriterAssets", {
  saveImageAsset: (request: { projectId: string; assetId?: string; name: string; mimeType: string; dataUrl: string }) =>
    ipcRenderer.invoke("lightwriter:save-asset-image", request),
  loadImageAsset: (request: { filePath: string }) => ipcRenderer.invoke("lightwriter:load-asset-image", request),
});

// Shared Series Bible (contract with ScriptToScreen): read/merge/write bible
// files, copy reference images into the bible, and watch for external changes.
contextBridge.exposeInMainWorld("lightwriterBible", {
  readBible: (seriesId: string) => ipcRenderer.invoke("lightwriter:bible-read", { seriesId }),
  readIndex: () => ipcRenderer.invoke("lightwriter:bible-read-index"),
  writeBible: (seriesId: string, json: string, expectedMtimeMs: number | null) =>
    ipcRenderer.invoke("lightwriter:bible-write", { seriesId, json, expectedMtimeMs }),
  writeIndex: (json: string, expectedMtimeMs: number | null) =>
    ipcRenderer.invoke("lightwriter:bible-write-index", { json, expectedMtimeMs }),
  copyAssetIn: (seriesId: string, source: { sourcePath?: string; dataUrl?: string; mimeType?: string }, stableKey: string) =>
    ipcRenderer.invoke("lightwriter:bible-copy-asset", { seriesId, ...source, stableKey }),
  watchBible: (seriesId: string) => ipcRenderer.invoke("lightwriter:bible-watch", { seriesId }),
  unwatchBible: (seriesId: string) => ipcRenderer.invoke("lightwriter:bible-unwatch", { seriesId }),
  onBibleChanged: (callback: (payload: { seriesId: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { seriesId: string }) => callback(payload);
    ipcRenderer.on("lightwriter:bible-changed", listener);
    return () => ipcRenderer.removeListener("lightwriter:bible-changed", listener);
  },
});
