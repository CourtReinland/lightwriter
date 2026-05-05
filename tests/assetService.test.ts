import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetService } from "../src/services/assetService";
import type { GeneratedAsset } from "../src/types/assets";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
}

function asset(overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return {
    id: "asset-1",
    projectId: "project-1",
    kind: "scene_set",
    provider: "gemini-nano-banana",
    model: "gemini-2.5-flash-image",
    name: "INT. COFFEE SHOP - DAY",
    prompt: "A warm cinematic coffee shop set, rainy windows, 35mm film still",
    mimeType: "image/png",
    imageDataUrl: "data:image/png;base64,abc",
    createdAt: 100,
    updatedAt: 100,
    scriptRef: {
      scriptHash: "hash-1",
      sceneHeading: "INT. COFFEE SHOP - DAY",
      sceneIndex: 0,
      sceneStartLine: 1,
      sceneEndLine: 8,
      contentExcerpt: "A cozy neighborhood cafe.",
    },
    metadata: {
      promptVersion: 1,
      aspectRatio: "16:9",
      script2ScreenShotKey: "s0_sh0",
    },
    ...overrides,
  };
}

describe("AssetService", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
    vi.spyOn(Date, "now").mockReturnValue(123456);
  });

  it("stores generated assets per project with script reference metadata", () => {
    AssetService.saveAssets("project-1", [asset()]);

    const stored = AssetService.getAssets("project-1");

    expect(stored).toHaveLength(1);
    expect(stored[0].scriptRef.sceneHeading).toBe("INT. COFFEE SHOP - DAY");
    expect(stored[0].metadata.script2ScreenShotKey).toBe("s0_sh0");
  });

  it("adds, updates, deletes, and filters assets without crossing project boundaries", () => {
    const sceneAsset = AssetService.addAsset("project-1", asset({ id: "", name: "Coffee Shop" }));
    const characterAsset = AssetService.addAsset(
      "project-1",
      asset({
        id: "",
        kind: "character",
        name: "ALEX",
        scriptRef: { scriptHash: "hash-1", characterName: "ALEX", contentExcerpt: "ALEX (30s, restless eyes)" },
      }),
    );
    AssetService.addAsset("project-2", asset({ id: "", projectId: "project-2", name: "Other" }));

    AssetService.updateAsset("project-1", sceneAsset.id, { name: "Rainy Coffee Shop" });

    expect(AssetService.getAssets("project-1")).toHaveLength(2);
    expect(AssetService.getAssets("project-2")).toHaveLength(1);
    expect(AssetService.getAssetsForScene("project-1", 0)[0].name).toBe("Rainy Coffee Shop");
    expect(AssetService.getAssetsForCharacter("project-1", "alex")[0].id).toBe(characterAsset.id);

    AssetService.deleteAsset("project-1", sceneAsset.id);
    expect(AssetService.getAssets("project-1").map((item) => item.id)).toEqual([characterAsset.id]);
  });
});
