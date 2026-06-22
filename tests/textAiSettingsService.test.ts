import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedTextModelOptions,
  getTextAiProviderSettings,
  getTextAiSettings,
  listClaudeTextModels,
  listGrokTextModels,
  listOpenAiTextModels,
  listTextModelsForProvider,
  saveTextAiProviderSettings,
  saveTextAiSettings,
  textAiKeyPlaceholder,
  textAiProviderLabel,
  textAiProviderOptions,
} from "../src/services/textAiSettingsService";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
}

describe("text AI provider settings", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
    vi.spyOn(Date, "now").mockReturnValue(123456);
  });

  it("stores one global writing/parser provider choice with separate keys per provider", () => {
    saveTextAiProviderSettings("grok", { apiKey: "xai-key" });
    saveTextAiProviderSettings("openai", { apiKey: "openai-key" });
    saveTextAiProviderSettings("claude", { apiKey: "claude-key" });
    saveTextAiSettings({ selectedProvider: "claude" });

    expect(getTextAiSettings().selectedProvider).toBe("claude");
    expect(getTextAiProviderSettings("grok").apiKey).toBe("xai-key");
    expect(getTextAiProviderSettings("openai").apiKey).toBe("openai-key");
    expect(getTextAiProviderSettings("claude").apiKey).toBe("claude-key");
  });

  it("migrates an existing Grok key into the global writing/parser settings", () => {
    localStorage.setItem("lw-grok-api-key", "legacy-xai-key");

    expect(getTextAiSettings().selectedProvider).toBe("grok");
    expect(getTextAiProviderSettings("grok").apiKey).toBe("legacy-xai-key");
  });
});

describe("live text-model listing", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
  });

  it("lists Grok chat models and drops image/video/embedding endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "grok-4.3" },
          { id: "grok-4.20-0309-reasoning" },
          { id: "grok-3-mini-fast" },
          { id: "grok-imagine-latest" },
          { id: "grok-2-image" },
          { id: "grok-2-vision-1212" }, // vision still a chat model — kept
          { id: "text-embedding-3" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const models = await listGrokTextModels("xai-key");

    expect(fetchMock).toHaveBeenCalledWith("https://api.x.ai/v1/models", {
      headers: { Authorization: "Bearer xai-key" },
    });
    const ids = models.map((m) => m.id);
    expect(ids).toContain("grok-4.3");
    expect(ids).toContain("grok-4.20-0309-reasoning");
    expect(ids).toContain("grok-3-mini-fast");
    expect(ids).not.toContain("grok-imagine-latest");
    expect(ids).not.toContain("grok-2-image");
    expect(ids).not.toContain("text-embedding-3");
  });

  it("lists only OpenAI chat models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "gpt-4o" },
          { id: "gpt-4o-mini" },
          { id: "o3" },
          { id: "gpt-3.5-turbo-instruct" }, // completion-only — dropped
          { id: "text-embedding-3-large" },
          { id: "dall-e-3" },
          { id: "whisper-1" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const ids = (await listOpenAiTextModels("sk-key")).map((m) => m.id);

    expect(ids).toEqual(["gpt-4o", "gpt-4o-mini", "o3"]);
  });

  it("lists Claude models using their display names", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "claude-3-5-sonnet-latest", display_name: "Claude 3.5 Sonnet" },
          { id: "claude-3-5-haiku-latest", display_name: "Claude 3.5 Haiku" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const models = await listClaudeTextModels("sk-ant-key");

    expect(fetchMock).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": "sk-ant-key", "anthropic-version": "2023-06-01" },
    });
    expect(models[0]).toEqual({ id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" });
  });

  it("returns the curated fallback list when there is no key (no network call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const models = await listTextModelsForProvider("grok", "   ");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(models).toEqual(getCachedTextModelOptions("grok"));
    expect(models.map((m) => m.id)).toContain("grok-4.3");
  });

  it("dispatches to the requested provider's endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "gpt-4o" }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const models = await listTextModelsForProvider("openai", "sk-key");

    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.any(Object));
    expect(models.map((m) => m.id)).toEqual(["gpt-4o"]);
  });

  it("throws a clear error when the provider rejects the key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" }));

    await expect(listGrokTextModels("bad-key")).rejects.toThrow(/401/);
  });

  it("lists OpenRouter chat models (slug ids, names as labels, embeds dropped, sorted)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "openai/gpt-4o", name: "OpenAI: GPT-4o" },
          { id: "anthropic/claude-3.5-sonnet", name: "Anthropic: Claude 3.5 Sonnet" },
          { id: "openai/text-embedding-3-large", name: "Embeddings" }, // dropped
          { id: "moonshotai/kimi-k2", name: "MoonshotAI: Kimi K2" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const models = await listTextModelsForProvider("openrouter", "sk-or-key");

    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models", expect.any(Object));
    expect(models.map((m) => m.id)).toEqual([
      "anthropic/claude-3.5-sonnet",
      "moonshotai/kimi-k2",
      "openai/gpt-4o",
    ]); // embedding dropped, sorted by id
    expect(models[0].label).toBe("Anthropic: Claude 3.5 Sonnet");
  });

  it("lists Kimi (Moonshot) models from the moonshot endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "kimi-latest" }, { id: "moonshot-v1-128k" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const models = await listTextModelsForProvider("kimi", "sk-key");

    expect(fetchMock).toHaveBeenCalledWith("https://api.moonshot.ai/v1/models", {
      headers: { Authorization: "Bearer sk-key" },
    });
    expect(models.map((m) => m.id)).toEqual(["kimi-latest", "moonshot-v1-128k"]);
  });
});

describe("provider metadata", () => {
  it("exposes all five providers with labels and key placeholders", () => {
    expect(textAiProviderOptions()).toEqual(["grok", "openai", "claude", "openrouter", "kimi"]);
    expect(textAiProviderLabel("openrouter")).toMatch(/OpenRouter/);
    expect(textAiProviderLabel("kimi")).toMatch(/Kimi/);
    expect(textAiKeyPlaceholder("openrouter")).toBe("sk-or-...");
    expect(textAiKeyPlaceholder("grok")).toBe("xai-...");
  });
});
