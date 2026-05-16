import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetDownloadFilename, downloadImageDataUrl, loadPersistedImageDataUrl, persistGeneratedImageFile } from "../src/services/imageAssetStorageService";

describe("imageAssetStorageService", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves generated images through the Electron bridge and returns the real file path", async () => {
    const saveImageAsset = vi.fn().mockResolvedValue({
      filePath: "/Users/capricorn/Library/Application Support/lightwriter-app/assets/project-1/scene.png",
    });
    vi.stubGlobal("window", { lightwriterAssets: { saveImageAsset } });

    const filePath = await persistGeneratedImageFile({
      projectId: "project-1",
      name: "INT. ROOM, DAY",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,aW1hZ2U=",
    });

    expect(saveImageAsset).toHaveBeenCalledWith({
      projectId: "project-1",
      assetId: undefined,
      name: "INT. ROOM, DAY",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,aW1hZ2U=",
    });
    expect(filePath).toBe("/Users/capricorn/Library/Application Support/lightwriter-app/assets/project-1/scene.png");
  });

  it("loads persisted Electron image files back as data URLs for thumbnails", async () => {
    const loadImageAsset = vi.fn().mockResolvedValue({ dataUrl: "data:image/png;base64,aW1hZ2U=" });
    vi.stubGlobal("window", { lightwriterAssets: { loadImageAsset } });

    const dataUrl = await loadPersistedImageDataUrl("/Users/capricorn/Library/Application Support/lightwriter-app/assets/project-1/scene.png");

    expect(loadImageAsset).toHaveBeenCalledWith({
      filePath: "/Users/capricorn/Library/Application Support/lightwriter-app/assets/project-1/scene.png",
    });
    expect(dataUrl).toBe("data:image/png;base64,aW1hZ2U=");
  });

  it("falls back gracefully when no Electron bridge is available", async () => {
    vi.stubGlobal("window", {});

    await expect(
      persistGeneratedImageFile({ projectId: "project-1", name: "Scene", mimeType: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" }),
    ).resolves.toBeUndefined();
  });

  it("builds safe download filenames and triggers browser download", () => {
    const click = vi.fn();
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ click, href: "", download: "" })),
      body: { appendChild, removeChild },
    });

    expect(assetDownloadFilename("INT. Room, DAY", "image/webp")).toBe("INT_Room_DAY.webp");
    downloadImageDataUrl({ name: "INT. Room, DAY", mimeType: "image/webp", dataUrl: "data:image/webp;base64,aW1hZ2U=" });

    expect(appendChild).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(removeChild).toHaveBeenCalledOnce();
  });
});
