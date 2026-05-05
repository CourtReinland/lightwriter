import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearImageProviderApiKey,
  getDefaultImageModel,
  getImageModelOptions,
  getImageProviderSettings,
  hasImageProviderApiKey,
  saveImageProviderSettings,
} from "../src/services/imageGenerationService";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
}

describe("imageGenerationService provider settings", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
    vi.spyOn(Date, "now").mockReturnValue(777);
  });

  it("offers multiple selectable model IDs per image provider", () => {
    expect(getImageModelOptions("gemini-nano-banana").map((option) => option.id)).toContain(
      "gemini-2.5-flash-image",
    );
    expect(getImageModelOptions("gemini-nano-banana").length).toBeGreaterThan(1);
    expect(getImageModelOptions("grok-imagine").map((option) => option.id)).toContain("grok-imagine-latest");
  });

  it("saves API keys and selected models locally per provider", () => {
    saveImageProviderSettings("gemini-nano-banana", {
      apiKey: "gemini-key",
      selectedModel: "custom-gemini-image-model",
    });
    saveImageProviderSettings("grok-imagine", {
      apiKey: "grok-key",
      selectedModel: "grok-imagine-latest",
    });

    expect(getImageProviderSettings("gemini-nano-banana").apiKey).toBe("gemini-key");
    expect(getImageProviderSettings("gemini-nano-banana").selectedModel).toBe("custom-gemini-image-model");
    expect(getImageProviderSettings("grok-imagine").apiKey).toBe("grok-key");
    expect(hasImageProviderApiKey("grok-imagine")).toBe(true);
  });

  it("clears provider keys without losing the selected model", () => {
    saveImageProviderSettings("gemini-nano-banana", {
      apiKey: "gemini-key",
      selectedModel: "custom-gemini-image-model",
    });

    clearImageProviderApiKey("gemini-nano-banana");

    expect(getImageProviderSettings("gemini-nano-banana").apiKey).toBe("");
    expect(getImageProviderSettings("gemini-nano-banana").selectedModel).toBe("custom-gemini-image-model");
  });

  it("falls back to default model when no settings are stored", () => {
    expect(getImageProviderSettings("gemini-nano-banana").selectedModel).toBe(
      getDefaultImageModel("gemini-nano-banana"),
    );
  });
});
