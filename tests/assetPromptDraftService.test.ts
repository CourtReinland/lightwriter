import { describe, expect, it } from "vitest";
import { mergeReviewedPromptDrafts, promptDraftKey } from "../src/services/assetPromptDraftService";

describe("assetPromptDraftService", () => {
  it("keys prompt drafts by asset source and script reference index", () => {
    expect(promptDraftKey("scene_set", 3)).toBe("scene_set:3");
    expect(promptDraftKey("shot", "12")).toBe("shot:12");
  });

  it("stores Generate All Prompts output as editable prompt drafts, not project asset/provider records", () => {
    const drafts = mergeReviewedPromptDrafts({ "character:0": "portrait draft" }, "scene_set", [
      "cozy living room set, warm daylight, rounded furniture",
      "rainy backyard patio, wet grass, soft moonlight",
    ]);

    expect(drafts).toEqual({
      "character:0": "portrait draft",
      "scene_set:0": "cozy living room set, warm daylight, rounded furniture",
      "scene_set:1": "rainy backyard patio, wet grass, soft moonlight",
    });
    expect(Object.values(drafts).every((value) => typeof value === "string")).toBe(true);
    expect(JSON.stringify(drafts)).not.toContain("gemini-nano-banana");
    expect(JSON.stringify(drafts)).not.toContain("Nano Banana");
  });
});
