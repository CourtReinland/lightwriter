import { describe, expect, it } from "vitest";
import { buildAssetKnowledgeItems } from "../src/services/assetKnowledgeViewService";
import type { GeneratedAsset } from "../src/types/assets";
import type { KnowledgeBase } from "../src/services/knowledgeBase";

function asset(overrides: Partial<GeneratedAsset>): GeneratedAsset {
  return {
    id: "asset-1",
    projectId: "p1",
    kind: "character",
    provider: "gemini-nano-banana",
    model: "model",
    name: "ALIYAH",
    prompt: "prompt fallback",
    mimeType: "image/png",
    filePath: "/tmp/aliyah.png",
    createdAt: 1,
    updatedAt: 1,
    scriptRef: { scriptHash: "hash", characterName: "ALIYAH", contentExcerpt: "script excerpt" },
    metadata: { promptVersion: 1 },
    ...overrides,
  };
}

const kb: KnowledgeBase = {
  projectId: "p1",
  characters: [{ id: "c1", name: "ALIYAH", description: "Saved character description", traits: [], voiceNotes: "", relationships: [] }],
  scenes: [{ id: "s1", heading: "INT. LIBRARY - NIGHT", sceneIndex: 0, description: "Saved scene description" }],
  worldRules: [],
  plotThreads: [],
  toneStyle: { genre: "", mood: "", pacingNotes: "" },
  customNotes: [],
  updatedAt: 1,
};

describe("assetKnowledgeViewService", () => {
  it("joins character assets with saved KB character descriptions", () => {
    const items = buildAssetKnowledgeItems([asset({})], kb, "character");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "ALIYAH", description: "Saved character description" });
  });

  it("joins scene assets with saved KB scene descriptions", () => {
    const items = buildAssetKnowledgeItems([
      asset({
        id: "scene-1",
        kind: "scene_set",
        name: "INT. LIBRARY - NIGHT",
        scriptRef: { scriptHash: "hash", sceneHeading: "INT. LIBRARY - NIGHT", sceneIndex: 0, contentExcerpt: "asset scene excerpt" },
      }),
    ], kb, "scene_set");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "INT. LIBRARY - NIGHT", description: "Saved scene description" });
  });
});
