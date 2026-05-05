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

  it("stores and clears a script-level style reference image per project", () => {
    StyleReferenceService.save("project-1", {
      name: "lookbook.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,abc",
    });

    expect(StyleReferenceService.get("project-1")).toEqual({
      projectId: "project-1",
      name: "lookbook.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,abc",
      updatedAt: 987654,
    });

    StyleReferenceService.clear("project-1");
    expect(StyleReferenceService.get("project-1")).toBeNull();
  });
});
