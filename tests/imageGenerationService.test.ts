import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGeneratedAssetFromResult,
  clearImageProviderApiKey,
  generateImageAsset,
  getDefaultImageModel,
  getImageModelOptions,
  getImageProviderSettings,
  hasImageProviderApiKey,
  listGeminiImageModels,
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

  it("polls Gemini directly and maps image-capable model IDs into selectable options", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            name: "models/gemini-2.5-flash-image",
            displayName: "Gemini Flash 2.5",
            description: "standard nano banana image generation",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemini-3.1-flash-image",
            displayName: "Gemini Flash 3.1",
            description: "nano banana 2 image generation",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemini-3-pro-image",
            displayName: "Gemini 3 Pro",
            description: "Nano banana 2 pro quality image model",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding-004",
            displayName: "Text Embedding 004",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const models = await listGeminiImageModels("gemini-key");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?key=gemini-key",
    );
    expect(models.slice(0, 3).map((model) => model.id)).toEqual([
      "gemini-2.5-flash-image",
      "gemini-3.1-flash-image",
      "gemini-3-pro-image",
    ]);
    expect(models.map((model) => model.id)).toContain("gemini-2.5-flash-image-preview");
    expect(models[1].label).toContain("Gemini Flash 3.1");
  });

  it("generates a Gemini image asset from the saved API key and returned inline image", async () => {
    saveImageProviderSettings("gemini-nano-banana", {
      apiKey: "gemini-key",
      selectedModel: "gemini-2.5-flash-image",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { text: "ok" },
                { inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImageAsset({
      projectId: "project-1",
      kind: "scene_set",
      provider: "gemini-nano-banana",
      model: "gemini-2.5-flash-image",
      name: "INT. LIVING ROOM, HOME, DAY",
      prompt: "Children's cartoon living room, soft daylight, cozy couch, playful set dressing.",
      scriptRef: { scriptHash: "abc", sceneHeading: "INT. LIVING ROOM, HOME, DAY", sceneIndex: 0 },
      aspectRatio: "16:9",
      styleReference: { name: "style.png", mimeType: "image/png", dataUrl: "data:image/png;base64,c3R5bGU=" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=gemini-key",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.contents[0].parts).toEqual([
      {
        text: expect.stringContaining("STYLE REFERENCE ONLY"),
      },
      { inlineData: { mimeType: "image/png", data: "c3R5bGU=" } },
      { text: "Children's cartoon living room, soft daylight, cozy couch, playful set dressing.\nAspect ratio: 16:9." },
    ]);
    expect(result).toMatchObject({ mimeType: "image/png", imageDataUrl: "data:image/png;base64,aW1hZ2U=" });

    const asset = buildGeneratedAssetFromResult(
      {
        projectId: "project-1",
        kind: "scene_set",
        provider: "gemini-nano-banana",
        model: "gemini-2.5-flash-image",
        name: "INT. LIVING ROOM, HOME, DAY",
        prompt: "Children's cartoon living room, soft daylight, cozy couch, playful set dressing.",
        scriptRef: { scriptHash: "abc", sceneHeading: "INT. LIVING ROOM, HOME, DAY", sceneIndex: 0 },
      },
      result,
    );
    expect(asset.imageDataUrl).toBe("data:image/png;base64,aW1hZ2U=");
  });
});
