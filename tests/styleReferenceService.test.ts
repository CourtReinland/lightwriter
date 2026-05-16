import { beforeEach, describe, expect, it, vi } from "vitest";
import { StyleReferenceService } from "../src/services/styleReferenceService";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
}

describe("StyleReferenceService", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
    vi.spyOn(Date, "now").mockReturnValue(987654);
  });

  it("stores and clears scene and character style references independently per project", () => {
    StyleReferenceService.save("project-1", { scope: "scene", name: "scene-look.png", mimeType: "image/png", dataUrl: "data:image/png;base64,scene" });
    StyleReferenceService.save("project-1", { scope: "character", name: "character-look.png", mimeType: "image/png", dataUrl: "data:image/png;base64,character" });

    expect(StyleReferenceService.get("project-1", "scene")).toEqual({
      projectId: "project-1",
      scope: "scene",
      name: "scene-look.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,scene",
      updatedAt: 987654,
    });
    expect(StyleReferenceService.get("project-1", "character")?.name).toBe("character-look.png");

    StyleReferenceService.clear("project-1", "scene");
    expect(StyleReferenceService.get("project-1", "scene")).toBeNull();
    expect(StyleReferenceService.get("project-1", "character")?.name).toBe("character-look.png");
  });
});
